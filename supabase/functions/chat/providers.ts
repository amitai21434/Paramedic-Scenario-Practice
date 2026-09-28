// Model backends behind one small interface, so switching AI is a setting
// (the admin page's model dropdown), not a rewrite. Add another provider by
// implementing ModelProvider and wiring it up in providerFor().

export type Message = { role: "user" | "assistant"; text: string };
export type ToolDef = { name: string; description: string; parameters: Record<string, unknown> };
export type ToolCall = { name: string; args: Record<string, unknown> };

export interface ModelProvider {
  /**
   * Generates a reply, streaming text through onText. When the model calls a
   * tool, runTool supplies the result and the provider continues, up to
   * maxToolRounds times. With forceTool, the model must call that tool and the
   * call is returned without continuing.
   */
  generate(opts: {
    system: string;
    messages: Message[];
    tools: ToolDef[];
    forceTool?: string;
    maxToolRounds?: number;
    onText?: (text: string) => void;
    runTool?: (call: ToolCall) => Promise<string>;
  }): Promise<{ text: string; toolCalls: ToolCall[] }>;
}

/** quota = rate/daily limit hit; unavailable = network/server down; config = our setup is wrong. */
export class ModelError extends Error {
  constructor(
    public kind: "quota" | "quota_daily" | "unavailable" | "config",
    message: string,
  ) {
    super(message);
  }
}

export function providerFor(model: string): ModelProvider {
  if (model === "stub") return stubProvider();
  if (model.startsWith("gemini")) {
    const key = Deno.env.get("GEMINI_API_KEY");
    if (!key) throw new ModelError("config", "GEMINI_API_KEY secret is not set");
    return geminiProvider(model, key);
  }
  throw new ModelError("config", `Unknown model "${model}"`);
}

// ---------------------------------------------------------------------------
// Gemini (generateContent REST API, streamed as server-sent events)
// ---------------------------------------------------------------------------

type GeminiPart = {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  functionCall?: { name: string; args?: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
};
type GeminiContent = { role: "user" | "model"; parts: GeminiPart[] };

function geminiProvider(model: string, apiKey: string): ModelProvider {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;

  return {
    async generate({ system, messages, tools, forceTool, maxToolRounds = 2, onText, runTool }) {
      const contents: GeminiContent[] = messages.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.text }],
      }));
      let text = "";
      const allCalls: ToolCall[] = [];

      for (let round = 0; ; round++) {
        const lastRound = round >= maxToolRounds;
        const mode = forceTool ? "ANY" : lastRound ? "NONE" : "AUTO";
        const body = {
          systemInstruction: { parts: [{ text: system }] },
          contents,
          ...(tools.length && {
            tools: [{ functionDeclarations: tools }],
            toolConfig: {
              functionCallingConfig: { mode, ...(forceTool && { allowedFunctionNames: [forceTool] }) },
            },
          }),
          generationConfig: { maxOutputTokens: 8192 },
        };

        let res: Response;
        try {
          res = await fetch(url, {
            method: "POST",
            headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
            body: JSON.stringify(body),
          });
        } catch (e) {
          throw new ModelError("unavailable", `Network error: ${e}`);
        }
        if (!res.ok) throw await geminiError(res);

        // Keep every part as returned (including thoughtSignature): Gemini
        // requires them back unchanged when continuing after a function call.
        const parts: GeminiPart[] = [];
        const calls: ToolCall[] = [];
        for await (const chunk of readSse(res)) {
          if (chunk.error) throw new ModelError("unavailable", JSON.stringify(chunk.error));
          for (const part of (chunk.candidates?.[0]?.content?.parts ?? []) as GeminiPart[]) {
            parts.push(part);
            if (part.text && !part.thought) {
              text += part.text;
              onText?.(part.text);
            }
            if (part.functionCall) calls.push({ name: part.functionCall.name, args: part.functionCall.args ?? {} });
          }
        }
        allCalls.push(...calls);

        if (!calls.length || forceTool || !runTool) return { text, toolCalls: allCalls };

        const results = await Promise.all(calls.map(runTool));
        contents.push({ role: "model", parts });
        contents.push({
          role: "user",
          parts: calls.map((c, i) => ({ functionResponse: { name: c.name, response: { content: results[i] } } })),
        });
      }
    },
  };
}

async function geminiError(res: Response): Promise<ModelError> {
  const detail = await res.text().catch(() => "");
  if (res.status === 429) {
    // Daily quota errors name a per-day metric; otherwise it's the per-minute limit.
    return new ModelError(/PerDay/i.test(detail) ? "quota_daily" : "quota", detail.slice(0, 500));
  }
  if (res.status >= 500) return new ModelError("unavailable", `Gemini ${res.status}: ${detail.slice(0, 500)}`);
  return new ModelError("config", `Gemini ${res.status}: ${detail.slice(0, 1000)}`);
}

async function* readSse(res: Response): AsyncGenerator<any> {
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let idx;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (line.startsWith("data:")) {
        const data = line.slice(5).trim();
        if (data) yield JSON.parse(data);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Stub: no AI call. Shows which book pages would have been sent, so the
// context-building can be checked without using any model quota.
// ---------------------------------------------------------------------------

function stubProvider(): ModelProvider {
  return {
    async generate({ system, messages, forceTool, onText }) {
      if (forceTool) return { text: "", toolCalls: [] }; // caller falls back to the shortlist
      const pieces = [...system.matchAll(/<<< (\S+) · (.+?) \(פרק/g)].map((m) => `• ${m[1]} — ${m[2]}`);
      const last = messages[messages.length - 1]?.text ?? "";
      const reply =
        `🧪 מצב בדיקה (ללא מודל).\n\nההודעה שלך: "${last}"\n\n` +
        `חומר מהאוגדן שהיה נשלח למודל (${pieces.length} חלקים, כ-${Math.round(system.length / 2).toLocaleString()} טוקנים בסך הכול):\n` +
        pieces.join("\n") +
        `\n\nהיסטוריית שיחה: ${messages.length - 1} הודעות קודמות.`;
      let text = "";
      for (const word of reply.split(/(?<= )/)) {
        text += word;
        onText?.(word);
        await new Promise((r) => setTimeout(r, 15));
      }
      return { text, toolCalls: [] };
    },
  };
}
