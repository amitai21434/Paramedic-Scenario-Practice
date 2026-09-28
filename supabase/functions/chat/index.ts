// Chat endpoint for signed-in users.
//
//   POST { message }        → streams the reply as NDJSON lines:
//                             {"type":"text","text":…} … {"type":"done"}
//                             or {"type":"error","message":…,"restore":true}
//   POST { action: "new" }  → archives the current conversation (new scenario)
//
// Each request is built fresh from: the admin's system instructions (read
// every time, so edits apply immediately) + the protocols chosen for this
// scenario, with their medication pages + the user's history + the new message.

import "@supabase/functions-js/edge-runtime.d.ts";
import { type SupabaseContext, withSupabase } from "@supabase/server";
import {
  expandWithDrugs,
  type IndexEntry,
  type Piece,
  scenarioPrompt,
  selectionPrompt,
  TOOLS,
} from "./prompt.ts";
import { ModelError, providerFor, type Message } from "./providers.ts";
import { detectStation, randomStation, shortlist, type Station } from "./stations.ts";

const MAX_MESSAGE_CHARS = 4000;

const ERRORS: Record<ModelError["kind"], string> = {
  quota_daily:
    "הגעת למכסה היומית של המודל החינמי. המכסה מתאפסת כל יום בשעה 10:00 בבוקר (שעון ישראל) — נסי שוב אז.",
  quota: "יותר מדי הודעות בזמן קצר. חכי דקה ונסי שוב.",
  unavailable: "המודל אינו זמין כרגע — נסי שוב בעוד כמה דקות.",
  config: "יש בעיה בהגדרות המודל. פני למנהל האתר.",
};

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    if (req.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });
    const db = ctx.supabaseAdmin;
    const userId = ctx.userClaims!.id;
    const body = await req.json().catch(() => ({}));

    if (body.action === "new") {
      await db
        .from("conversations")
        .update({ archived_at: new Date().toISOString() })
        .eq("user_id", userId)
        .is("archived_at", null);
      return Response.json({ ok: true });
    }

    const message = String(body.message ?? "").trim();
    if (!message) return Response.json({ error: "Empty message" }, { status: 400 });
    if (message.length > MAX_MESSAGE_CHARS) return Response.json({ error: "Message too long" }, { status: 400 });

    const conversationId = await activeConversation(db, userId);
    const [settings, history, index] = await Promise.all([
      loadSettings(db),
      db.from("messages").select("role, content").eq("conversation_id", conversationId).order("id"),
      db.from("reference_pieces").select("id, chapter, title, part").order("id"),
    ]);
    const { data: saved } = await db
      .from("messages")
      .insert({ conversation_id: conversationId, role: "user", content: message })
      .select("id")
      .single();

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (o: unknown) => controller.enqueue(encoder.encode(JSON.stringify(o) + "\n"));
        let reply = "";
        try {
          const provider = providerFor(settings.model);
          const messages: Message[] = [
            ...(history.data ?? []).map((m) => ({ role: m.role as Message["role"], text: m.content })),
            { role: "user", text: message },
          ];
          const state = await scenarioState(db, conversationId, {
            provider,
            settings,
            message,
            index: index.data ?? [],
          });

          reply = (
            await provider.generate({
              system: await buildScenarioSystem(db, state, settings, index.data ?? [], history.data?.length === 0),
              messages,
              tools: [TOOLS.lookup_reference],
              maxToolRounds: 2,
              onText: (text) => send({ type: "text", text }),
              runTool: (call) => lookup(db, conversationId, call.args.piece_ids),
            })
          ).text;

          if (!reply.trim()) throw new ModelError("unavailable", "Empty reply");
          await db.from("messages").insert({ conversation_id: conversationId, role: "assistant", content: reply });
          send({ type: "done" });
        } catch (e) {
          const err = e instanceof ModelError ? e : new ModelError("unavailable", String(e));
          console.error(`[chat] ${err.kind}: ${err.message}`);
          if (reply.trim()) {
            // Keep what was already shown, so history matches the screen.
            await db.from("messages").insert({ conversation_id: conversationId, role: "assistant", content: reply });
            send({ type: "error", message: ERRORS[err.kind], restore: false });
          } else {
            // Nothing was answered: drop the user's message so they can resend it.
            if (saved) await db.from("messages").delete().eq("id", saved.id);
            send({ type: "error", message: ERRORS[err.kind], restore: true });
          }
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-cache" },
    });
  }),
};

// ---------------------------------------------------------------------------

type Db = SupabaseContext["supabaseAdmin"];
type Settings = { instructions: string; examples: string; model: string };
type State = { station: Station; piece_ids: string[] };

async function activeConversation(db: Db, userId: string): Promise<string> {
  const find = () =>
    db.from("conversations").select("id").eq("user_id", userId).is("archived_at", null).maybeSingle();
  const { data } = await find();
  if (data) return data.id;
  const { data: created, error } = await db.from("conversations").insert({ user_id: userId }).select("id").single();
  if (created) return created.id;
  // Lost a race with a parallel request (unique index on active conversation).
  const { data: again } = await find();
  if (again) return again.id;
  throw new Error(`Could not create conversation: ${error?.message}`);
}

async function loadSettings(db: Db): Promise<Settings> {
  const { data } = await db.from("settings").select("key, value");
  const get = (k: string) => data?.find((r) => r.key === k)?.value ?? "";
  return { instructions: get("system_instructions"), examples: get("scenario_examples"), model: get("model") || "stub" };
}

/**
 * On the first message of a conversation, the model picks the protocol(s)
 * from a random shortlist of the station (the student may name a station;
 * otherwise one is chosen at random). Stored server-side, never shown.
 */
async function scenarioState(
  db: Db,
  conversationId: string,
  opts: { provider: ReturnType<typeof providerFor>; settings: Settings; message: string; index: IndexEntry[] },
): Promise<State> {
  const { data: existing } = await db
    .from("scenario_state")
    .select("station, piece_ids")
    .eq("conversation_id", conversationId)
    .maybeSingle();
  if (existing) return existing as State;

  const station = detectStation(opts.message) ?? randomStation();
  const listed = shortlist(station);
  const known = new Map(opts.index.map((p) => [p.id, p]));

  const { toolCalls } = await opts.provider.generate({
    system: selectionPrompt({
      instructions: opts.settings.instructions,
      examples: opts.settings.examples,
      station,
      shortlist: listed.map((id) => known.get(id)!).filter(Boolean),
      index: opts.index,
    }),
    messages: [{ role: "user", text: opts.message }],
    tools: [TOOLS.choose_protocols],
    forceTool: TOOLS.choose_protocols.name,
  });

  const picked = toIds(toolCalls[0]?.args.piece_ids).filter((id) => known.has(id)).slice(0, 3);
  // The primary protocol must come from the shortlist (that's what makes it random).
  const primary = picked.find((id) => listed.includes(id)) ?? listed[0];
  const piece_ids = [primary, ...picked.filter((id) => id !== primary)];

  const state = { station, piece_ids };
  await db.from("scenario_state").insert({ conversation_id: conversationId, ...state });
  return state;
}

async function buildScenarioSystem(
  db: Db,
  state: State,
  settings: Settings,
  index: IndexEntry[],
  isOpening: boolean,
): Promise<string> {
  const [{ data: chosen }, { data: drugPages }] = await Promise.all([
    db.from("reference_pieces").select("*").in("id", state.piece_ids),
    db.from("reference_pieces").select("*").eq("chapter", 10),
  ]);
  const ordered = state.piece_ids.map((id) => chosen?.find((p) => p.id === id)).filter(Boolean) as Piece[];
  return scenarioPrompt({
    instructions: settings.instructions,
    examples: settings.examples,
    station: state.station,
    pieces: expandWithDrugs(ordered, [...ordered, ...((drugPages ?? []) as Piece[])]),
    index,
    isOpening,
  });
}

/** Tool: returns exact book text; looked-up pieces stay in context for later turns. */
async function lookup(db: Db, conversationId: string, rawIds: unknown): Promise<string> {
  const ids = toIds(rawIds).slice(0, 3);
  const { data } = await db.from("reference_pieces").select("id, title, part, body").in("id", ids);
  if (!data?.length) return "לא נמצאו פרוטוקולים עם המזהים האלה. בדקי את המזהים באינדקס.";

  const { data: state } = await db
    .from("scenario_state")
    .select("piece_ids")
    .eq("conversation_id", conversationId)
    .single();
  if (state) {
    const merged = [...new Set([...state.piece_ids, ...data.map((p) => p.id)])];
    await db.from("scenario_state").update({ piece_ids: merged }).eq("conversation_id", conversationId);
  }
  return data.map((p) => `<<< ${p.id} · ${p.title}${p.part ? ` (חלק ${p.part})` : ""} >>>\n${p.body}`).join("\n\n");
}

function toIds(value: unknown): string[] {
  return Array.isArray(value) ? value.map((v) => String(v).trim()).filter(Boolean) : [];
}
