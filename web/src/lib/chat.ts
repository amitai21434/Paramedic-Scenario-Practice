import { supabase } from "./supabase";

export type ChatEvent =
  | { type: "text"; text: string }
  | { type: "done" }
  | { type: "error"; message: string; restore: boolean };

const endpoint = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`;

async function call(body: unknown): Promise<Response> {
  const { data } = await supabase.auth.getSession();
  return fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      authorization: `Bearer ${data.session?.access_token ?? ""}`,
    },
    body: JSON.stringify(body),
  });
}

/** Sends a message and reports the streamed reply (NDJSON lines) via onEvent. */
export async function sendMessage(message: string, onEvent: (e: ChatEvent) => void): Promise<void> {
  let res: Response;
  try {
    res = await call({ message });
  } catch {
    return onEvent({ type: "error", message: "אין חיבור לשרת. בדקי את האינטרנט ונסי שוב.", restore: true });
  }
  if (!res.ok || !res.body) {
    return onEvent({ type: "error", message: "השליחה נכשלה. נסי שוב.", restore: true });
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let finished = false;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let idx;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      const event = JSON.parse(line) as ChatEvent;
      if (event.type !== "text") finished = true;
      onEvent(event);
    }
  }
  if (!finished) onEvent({ type: "error", message: "החיבור נקטע באמצע התשובה.", restore: false });
}

export async function startNewScenario(): Promise<boolean> {
  const res = await call({ action: "new" }).catch(() => null);
  return !!res?.ok;
}
