// The scenario conversation: the dispatch card and the message bubbles.
// Used live on the practice page and read-only in the admin's saved runs.

import { clock } from "../engine/engine";
import type { Message } from "../engine/types";
import { PaperStrip, TwelveLead } from "./Ecg";

export function DispatchCard({ text }: { text: string }) {
  const [dispatch, ...scene] = text.replace(/^📟\s*/, "").split("\n");
  return (
    <div className="msg-in overflow-hidden rounded-xl border border-accent/40 bg-panel shadow-lg shadow-black/30">
      <div className="flex items-center gap-2 border-b border-accent/30 bg-accent/15 px-4 py-2 text-xs font-semibold tracking-wide text-red-200">
        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent" /> קריאה מהמוקד
      </div>
      <div className="space-y-2 px-4 py-3">
        <p dir="auto" className="text-lg font-semibold leading-snug">
          {dispatch}
        </p>
        {scene.length > 0 && (
          <p dir="auto" className="text-[15px] leading-relaxed text-ink/80">
            {scene.join("\n")}
          </p>
        )}
      </div>
    </div>
  );
}

export function Bubble({ m }: { m: Message }) {
  if (m.from === "user") {
    return (
      <div className="msg-in flex flex-col items-start gap-1">
        <div dir="auto" className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-ss-sm bg-ink px-3.5 py-2 text-[15px] text-bg">
          {m.text}
        </div>
        {m.items && m.items.length > 0 && (
          <div className="flex max-w-[85%] flex-wrap gap-1">
            {m.items.map((it, i) => (
              <span key={i} dir="auto" className="rounded-full border border-line bg-panel px-2 py-0.5 text-[11px] text-muted">
                {it}
              </span>
            ))}
          </div>
        )}
      </div>
    );
  }
  if ("ecg" in m) {
    return (
      <figure className="msg-in space-y-1">
        <figcaption className="font-mono text-xs text-muted">
          {clock(m.t)} · {m.caption}
        </figcaption>
        <div dir="ltr" className="overflow-x-auto rounded-lg border border-line">
          {m.ecg.mode === "12" || m.ecg.mode === "right" ? <TwelveLead snap={m.ecg} /> : <PaperStrip snap={m.ecg} />}
        </div>
      </figure>
    );
  }
  return (
    <div className="msg-in flex justify-end">
      <div dir="auto" className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-se-sm border border-line bg-panel px-3.5 py-2 text-[15px] leading-relaxed">
        <span className="me-2 font-mono text-xs text-muted">{clock(m.t)}</span>
        {m.text}
      </div>
    </div>
  );
}
