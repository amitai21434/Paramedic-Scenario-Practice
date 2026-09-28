import { Fragment, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { sendMessage, startNewScenario } from "../lib/chat";
import { supabase } from "../lib/supabase";

type Msg = { role: "user" | "assistant"; content: string };

export default function Chat() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState<string | null>(null); // assistant reply in progress
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const busy = streaming !== null;

  // Load the current (non-archived) conversation. RLS limits this to the user's own.
  useEffect(() => {
    (async () => {
      const { data: convo } = await supabase
        .from("conversations")
        .select("id")
        .is("archived_at", null)
        .maybeSingle();
      if (convo) {
        const { data } = await supabase
          .from("messages")
          .select("role, content")
          .eq("conversation_id", convo.id)
          .order("id");
        setMessages((data ?? []) as Msg[]);
      }
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, streaming]);

  async function send(e?: FormEvent) {
    e?.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setError(null);
    setMessages((m) => [...m, { role: "user", content: text }]);
    setStreaming("");

    let reply = "";
    await sendMessage(text, (event) => {
      if (event.type === "text") {
        reply += event.text;
        setStreaming(reply);
      } else if (event.type === "error") {
        setError(event.message);
        if (event.restore) {
          // Nothing was answered and the server dropped the message: undo locally too.
          setMessages((m) => m.slice(0, -1));
          setInput(text);
        }
      }
    });
    if (reply) setMessages((m) => [...m, { role: "assistant", content: reply }]);
    setStreaming(null);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  }

  async function newScenario() {
    if (messages.length && !confirm("להתחיל תרחיש חדש? התרחיש הנוכחי יישמר בארכיון.")) return;
    if (await startNewScenario()) {
      setMessages([]);
      setError(null);
    } else {
      setError("לא הצלחתי להתחיל תרחיש חדש. נסי שוב.");
    }
  }

  return (
    <main dir="rtl" className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 pb-4">
      <div className="flex items-center justify-between py-3">
        <h1 className="text-lg font-semibold">תרגול תרחישים</h1>
        <button onClick={newScenario} disabled={busy} className="rounded border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-900">
          תרחיש חדש
        </button>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto pb-4">
        {loading && <p className="text-neutral-500">טוען…</p>}
        {!loading && messages.length === 0 && !busy && (
          <div className="rounded border border-dashed border-neutral-300 p-4 text-sm text-neutral-500 dark:border-neutral-700">
            <p>כתבי <strong>״תן לי תרחיש״</strong> כדי להתחיל תרחיש אקראי,</p>
            <p>או בקשי תחנה מסוימת: <strong>קרדיו</strong> · <strong>מצחים</strong> · <strong>ילדים</strong> · <strong>טראומה</strong>.</p>
          </div>
        )}
        {messages.map((m, i) => (
          <Bubble key={i} role={m.role} text={m.content} />
        ))}
        {busy && <Bubble role="assistant" text={streaming || "…"} />}
        {error && (
          <p className="rounded bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>
        )}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={send} className="flex items-end gap-2 border-t border-neutral-200 pt-3 dark:border-neutral-800">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          rows={2}
          dir="auto"
          placeholder="מה את עושה?"
          className="input flex-1 resize-none"
        />
        <button disabled={busy || !input.trim()} className="btn">
          שליחה
        </button>
      </form>
    </main>
  );
}

function Bubble({ role, text }: { role: Msg["role"]; text: string }) {
  const mine = role === "user";
  return (
    <div className={`flex ${mine ? "justify-start" : "justify-end"}`}>
      <div
        dir="auto"
        className={`max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-[15px] leading-relaxed ${
          mine ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900" : "bg-neutral-100 dark:bg-neutral-900"
        }`}
      >
        <Formatted text={text} />
      </div>
    </div>
  );
}

// Minimal formatting for model output: **bold** only, rendered without HTML injection.
function Formatted({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*)/g).map((chunk, i) =>
        chunk.startsWith("**") && chunk.endsWith("**") ? (
          <strong key={i}>{chunk.slice(2, -2)}</strong>
        ) : (
          <Fragment key={i}>{chunk}</Fragment>
        ),
      )}
    </>
  );
}
