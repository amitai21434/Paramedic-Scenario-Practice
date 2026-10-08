import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useAuth } from "../auth";
import { LiveMonitor, PaperStrip, TwelveLead } from "../components/Ecg";
import { ScoreRing } from "../components/Score";
import { debrief } from "../engine/debrief";
import { clock, ecgSnapshot, pickTemplate, rollComplication, startSim, step } from "../engine/engine";
import { effectiveVitals } from "../engine/physiology";
import type { Content, Message, Sim } from "../engine/types";
import { loadContent, logUnrecognized } from "../lib/content";
import { weakSpots } from "../lib/history";
import { loadResults, saveResult } from "../lib/results";

const STATIONS = ["קרדיו", "מצחים", "ילדים", "טראומה"];
const SAVE_KEY = "practice.sim.v1";
const RECENT_KEY = "practice.recent.v1";

// Browser storage can be unavailable (private mode, blocked site data) — the page works without it.
function load<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function save(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

export default function Practice() {
  const [content, setContent] = useState<Content | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sim, setSim] = useState<Sim | null>(() => load<Sim>(SAVE_KEY));
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadContent().then(setContent, (e) => setLoadError(String(e?.message ?? e)));
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [sim?.messages.length]);

  // Save each finished run to the history once (best effort; retried on reload if it failed).
  useEffect(() => {
    if (!content || !sim?.ended || sim.saved) return;
    let cancelled = false;
    saveResult(content, sim).then((r) => {
      if (!cancelled && r !== "failed") update({ ...sim, saved: r });
    });
    return () => {
      cancelled = true;
    };
  }, [content, sim]);

  function update(next: Sim | null) {
    setSim(next);
    save(SAVE_KEY, next);
  }

  function start(station: string | null) {
    if (!content) return;
    const recent = load<string[]>(RECENT_KEY) ?? [];
    const id = pickTemplate(content, station, recent);
    const seed = crypto.getRandomValues(new Uint32Array(1))[0];
    save(RECENT_KEY, [id, ...recent].slice(0, 2));
    update(startSim(content, id, seed, undefined, rollComplication(content, id, seed)));
    setInput("");
  }

  function home() {
    if (sim && !sim.ended && sim.messages.length > 2 && !confirm("לצאת מהתרחיש? התרחיש הנוכחי יימחק.")) return;
    update(null);
  }

  function send(text: string) {
    if (!content || !sim || !text.trim()) return;
    const r = step(content, sim, text.trim());
    update(r.sim);
    if (!r.understood) logUnrecognized(text.trim(), `${sim.case.templateId}/${sim.case.variantId}`).catch(() => {});
  }

  function onSubmit(e?: FormEvent) {
    e?.preventDefault();
    send(input);
    setInput("");
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      onSubmit();
    }
  }

  return (
    <main dir="rtl" className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 pb-4">
      <div className="flex flex-wrap items-center gap-2 py-3">
        <h1 className="me-auto flex items-center gap-2 text-lg font-bold tracking-tight">
          <Pulse /> תרגול תרחישים
        </h1>
        <HowToPlay />
        {sim && !sim.ended && (
          <span className="rounded-md border border-line bg-black/60 px-2.5 py-1 font-mono text-sm tabular-nums text-ecg" title="זמן בתרחיש">
            {clock(sim.t)}
          </span>
        )}
        {sim && (
          <button onClick={home} className="btn-ghost">
            תרחיש חדש
          </button>
        )}
      </div>

      {loadError && <p className="rounded-md border border-accent/40 bg-accent/10 p-3 text-sm text-red-200">לא הצלחתי לטעון את התרחישים: {loadError}</p>}

      {!sim && !loadError && <Home content={content} onStart={start} />}

      {sim && content && (
        <div className="flex flex-1 flex-col gap-4 md:flex-row-reverse md:items-start">
          <aside className="md:sticky md:top-4 md:w-80 md:shrink-0">
            <MonitorPanel sim={sim} />
          </aside>
          <section className="flex min-w-0 flex-1 flex-col">
            <div className="flex-1 space-y-3 pb-4">
              {sim.messages.map((m, i) => (i === 0 && m.from === "examiner" && "text" in m ? <DispatchCard key={i} text={m.text} /> : <Bubble key={i} m={m} />))}
              {sim.ended && <DebriefView content={content} sim={sim} onNew={home} />}
              <div ref={bottomRef} />
            </div>
            {!sim.ended && (
              <form onSubmit={onSubmit} className="sticky bottom-0 flex items-end gap-2 border-t border-line bg-bg/95 pt-3 backdrop-blur">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={onKeyDown}
                  rows={2}
                  dir="auto"
                  placeholder="מה את עושה?"
                  className="input flex-1 resize-none text-base"
                  autoFocus
                />
                <div className="flex flex-col gap-1">
                  <button disabled={!input.trim()} className="btn">
                    שליחה
                  </button>
                  <button type="button" onClick={() => send("סיום")} className="btn-ghost px-3 py-1 text-xs">
                    סיום
                  </button>
                </div>
              </form>
            )}
          </section>
        </div>
      )}
    </main>
  );
}

/** A small heartbeat mark for the title. */
function Pulse() {
  return (
    <svg viewBox="0 0 32 16" className="h-4 w-8 text-accent" aria-hidden>
      <path d="M0 9 H9 L11 4 L14 14 L17 1 L20 9 H32" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Home: random first (the exam doesn't let you choose), stations for focused practice.
// ---------------------------------------------------------------------------

function Home({ content, onStart }: { content: Content | null; onStart: (station: string | null) => void }) {
  const { session } = useAuth();
  const [avg, setAvg] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!session) return;
    loadResults(session.user.id)
      .then((rows) => setAvg(Object.fromEntries(weakSpots(rows).stations.map((s) => [s.station, s.avg]))))
      .catch(() => {});
  }, [session]);

  const counts = useMemo(() => {
    const n: Record<string, number> = {};
    for (const c of content?.cases ?? []) n[c.station] = (n[c.station] ?? 0) + Math.max(1, c.variants?.length ?? 0);
    return n;
  }, [content]);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 py-6">
      <button
        onClick={() => onStart(null)}
        disabled={!content}
        className="group relative w-full overflow-hidden rounded-2xl border border-accent/40 bg-gradient-to-l from-accent/25 via-panel to-panel p-6 text-start shadow-xl shadow-black/40 transition hover:border-accent/70 disabled:opacity-50"
      >
        <svg viewBox="0 0 400 60" preserveAspectRatio="none" className="pointer-events-none absolute inset-x-0 bottom-0 h-16 w-full text-accent/25" aria-hidden>
          <path d="M0 40 H120 L135 15 L150 55 L165 5 L180 40 H260 L272 25 L284 40 H400" fill="none" stroke="currentColor" strokeWidth="2" />
        </svg>
        <span className="relative block text-2xl font-extrabold">תרחיש אקראי</span>
        <span className="relative mt-1 block text-sm text-muted">כמו במבחן — תרחיש מכל התחנות{total ? `, מתוך ${total}` : ""}</span>
        <span className="relative mt-4 inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white transition group-hover:bg-accent-hover">
          התחלה ←
        </span>
      </button>

      <div>
        <h2 className="mb-2 text-sm font-medium text-muted">או תרגול ממוקד לפי תחנה</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {STATIONS.map((s) => (
            <button
              key={s}
              onClick={() => onStart(s)}
              disabled={!content || !counts[s]}
              className="card p-4 text-start transition hover:border-muted/50 hover:bg-panel-2 disabled:opacity-40"
            >
              <span className="block text-lg font-bold">{s}</span>
              <span className="mt-1 block text-xs text-muted">{counts[s] ?? 0} תרחישים</span>
              {avg[s] !== undefined && <span className="mt-2 block font-mono text-xs text-ink/80">ממוצע שלך: {avg[s]}%</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Optional instructions — a small button, never in the way. */
function HowToPlay() {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} className="btn-ghost px-2.5 py-1 text-xs" aria-expanded={open}>
        ? איך משחקים
      </button>
      {open && (
        <div className="card absolute end-0 top-full z-20 mt-2 w-80 space-y-2 p-4 text-sm leading-relaxed">
          <p>כתבי מה את עושה, במילים שלך — פעולה אחת או כמה במשפט: &quot;מחברת מוניטור ומודדת לחץ דם&quot;, &quot;אספירין 300 מ&quot;ג בלעיסה&quot;, &quot;מה קרה?&quot;.</p>
          <p>מתחת להודעה יופיע מה הובן. הטעויות לא נאמרות בזמן התרחיש — הן מופיעות במשוב בסוף.</p>
          <p>אפשר לומר אבחנה או קריאת אק&quot;ג (&quot;חושדת ב־STEMI תחתון&quot;) — היא תופיע במשוב.</p>
          <p>בסוף כתבי &quot;פינוי&quot;, ו&quot;סיום&quot; כשמגיעים לבית החולים.</p>
          <button onClick={() => setOpen(false)} className="btn-ghost w-full py-1 text-xs">
            סגירה
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Conversation
// ---------------------------------------------------------------------------

function DispatchCard({ text }: { text: string }) {
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

function Bubble({ m }: { m: Message }) {
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

// ---------------------------------------------------------------------------
// Monitor
// ---------------------------------------------------------------------------

function MonitorPanel({ sim }: { sim: Sim }) {
  const flags = new Set(sim.flags);
  const v = effectiveVitals(sim);
  const bp = sim.measured.sbp;
  const dbp = sim.measured.dbp;
  const extras = (["rr", "glucose", "temp", "gcs"] as const).filter((k) => sim.measured[k]);
  const labels = { rr: "נשימות", glucose: "סוכר", temp: "חום", gcs: "GCS" };
  const [beat, setBeat] = useState(0);
  const connected = flags.has("monitor");
  const cpr = flags.has("cpr");
  const snap = useMemo(() => (connected ? ecgSnapshot(sim, cpr ? "cpr" : "strip") : null), [connected, cpr, sim]);
  // Rebuild the live trace only when the rhythm itself changes, not on every message.
  const key = snap ? `${snap.rhythm}|${snap.hr}|${snap.mode}|${snap.wide}|${snap.pulseless}|${snap.peakedT}|${JSON.stringify(snap.st)}` : "";
  const stable = useMemo(() => snap, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!connected || !stable) {
    return (
      <div dir="ltr" className="overflow-hidden rounded-xl border border-line bg-black/80 font-mono shadow-lg shadow-black/40">
        <div className="flex h-28 items-center justify-center text-sm text-muted">
          <span dir="rtl">מוניטור לא מחובר</span>
        </div>
        {bp && (
          <div className="grid grid-cols-1 border-t border-line">
            <Reading label={`NIBP ${clock(bp.t)}`} value={bp.value === null ? "---" : `${bp.value}/${dbp?.value}`} color="text-nibp" />
          </div>
        )}
      </div>
    );
  }
  const hr = cpr ? "--" : v.hr === null ? "---" : v.hr;
  return (
    <div dir="ltr" className="overflow-hidden rounded-xl border border-line bg-black font-mono text-white shadow-lg shadow-black/40">
      <div className="flex items-center justify-between px-3 pt-2 text-[10px] text-ecg/80">
        <span>II · 25 mm/s</span>
        <span>{cpr ? "CPR" : "MONITOR"}</span>
      </div>
      <LiveMonitor snap={stable} onBeat={() => setBeat((b) => b + 1)} />
      <div className="grid grid-cols-2 gap-px border-t border-line bg-line">
        <Reading
          label="HR"
          value={hr}
          color="text-ecg"
          badge={
            <span key={beat} className="text-accent [animation:msg-in_300ms_ease-out]" aria-hidden>
              ♥
            </span>
          }
        />
        <Reading label="SpO2" value={flags.has("spo2probe") ? (v.spo2 === null ? "---" : v.spo2) : "—"} color="text-spo2" unit="%" />
        <Reading label={`NIBP${bp ? ` ${clock(bp.t)}` : ""}`} value={bp ? (bp.value === null ? "---" : `${bp.value}/${dbp?.value}`) : "—"} color="text-nibp" />
        <Reading label="EtCO2" value={flags.has("capno") ? (v.etco2 ?? "---") : "—"} color="text-co2" />
      </div>
      {extras.length > 0 && (
        <div dir="rtl" className="flex flex-wrap gap-x-3 gap-y-1 border-t border-line bg-panel px-3 py-2 text-xs text-ink/80">
          {extras.map((k) => (
            <span key={k}>
              {labels[k]}: {sim.measured[k]!.value ?? "—"}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function Reading({ label, value, color, unit, badge }: { label: string; value: string | number; color: string; unit?: string; badge?: React.ReactNode }) {
  return (
    <div className="bg-black px-3 py-2">
      <div className="flex items-center justify-between text-[10px] text-muted">
        <span>{label}</span>
        {badge}
      </div>
      <div className={`text-3xl font-bold leading-tight tabular-nums ${color}`}>
        {value}
        {unit && value !== "—" && value !== "---" && <span className="ms-0.5 text-xs font-medium">{unit}</span>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Debrief
// ---------------------------------------------------------------------------

/** Diagnosis and ECG reading — informational only, not part of the score. */
function DiagnosisSection({ d }: { d: ReturnType<typeof debrief>["diagnosis"] }) {
  const rows = [...d.items, ...d.rhythms.map((r) => ({ ...r, label: `קצב: ${r.label}` }))];
  if (!rows.length && !d.unmatched.length) return null;
  return (
    <div>
      <h3 className="mb-1 font-semibold">אבחנה וקריאת אק&quot;ג</h3>
      <p className="mb-2 text-xs text-muted">למידע בלבד — לא נספר בציון.</p>
      <ul className="space-y-1 text-sm">
        {rows.map((r, i) => (
          <li key={i} className="flex gap-2">
            <span aria-hidden>{r.statedAt === null ? "▫️" : "✅"}</span>
            <span className={r.statedAt === null ? "text-muted" : ""}>
              {r.label}
              {r.statedAt === null ? <span className="ms-1 text-xs">— לא נאמר</span> : <span className="ms-1 font-mono text-xs text-muted">({clock(r.statedAt)})</span>}
            </span>
          </li>
        ))}
        {d.unmatched.map((u, i) => (
          <li key={`u${i}`} className="flex gap-2 text-muted">
            <span aria-hidden>➖</span>
            <span dir="auto">
              נאמר: &quot;{u.text}&quot; <span className="text-xs">— לא תואם</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DebriefView({ content, sim, onNew }: { content: Content; sim: Sim; onNew: () => void }) {
  const d = debrief(content, sim);
  const pct = d.score.total ? Math.round((100 * d.score.done) / d.score.total) : 0;
  return (
    <section className="msg-in card space-y-5 p-5">
      <div className="flex flex-wrap items-center gap-5">
        <ScoreRing value={pct} />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-xs font-medium tracking-wide text-muted">סיכום התרחיש</p>
          <h2 className="text-xl font-bold">{d.title}</h2>
          <p className="text-sm text-muted">{d.patient}</p>
          <p className="text-sm">{d.outcome}</p>
          <p className="text-sm">
            {d.score.done}/{d.score.total} פעולות לפי הפרוטוקול
            {d.score.criticalMissed > 0 && <span className="ms-2 font-semibold text-red-300">❌ {d.score.criticalMissed} פעולות קריטיות חסרות</span>}
          </p>
          {sim.saved === "saved" && <p className="text-xs text-muted">✓ נשמר בהיסטוריה שלך</p>}
        </div>
      </div>

      {d.complication && (
        <p className="rounded-md border border-co2/30 bg-co2/10 px-3 py-2 text-sm">
          ⚡ סיבוך במהלך התרחיש: {d.complication.title} ({clock(d.complication.at)})
          {d.complication.resolvedAt !== null ? ` — טופל ב־${clock(d.complication.resolvedAt)}` : " — לא טופל"}
        </p>
      )}

      {d.errors.length > 0 && (
        <div className="rounded-lg border border-accent/40 bg-accent/10 p-3">
          <h3 className="mb-2 font-semibold text-red-200">טעויות</h3>
          <ul className="space-y-1 text-sm">
            {d.errors.map((e, i) => (
              <li key={i}>
                <span className="font-mono text-xs text-muted">{clock(e.t)}</span> {e.text}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <h3 className="mb-2 font-semibold">לפי הפרוטוקול</h3>
        <ul className="space-y-1 text-sm">
          {d.checklist.map((c, i) => (
            <li key={i} className="flex gap-2">
              <span aria-hidden>{c.doneAt === null ? (c.critical ? "❌" : "⬜") : c.late ? "⚠️" : "✅"}</span>
              <span className={c.doneAt === null && c.critical ? "font-semibold text-red-300" : c.doneAt === null ? "text-muted" : ""}>
                {c.label}
                {c.doneAt !== null && (
                  <span className="ms-1 font-mono text-xs text-muted">
                    ({clock(c.doneAt)}
                    {c.late ? " — באיחור" : ""})
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {d.warnings.length > 0 && (
        <div>
          <h3 className="mb-2 font-semibold text-co2">הערות</h3>
          <ul className="space-y-1 text-sm">
            {d.warnings.map((e, i) => (
              <li key={i}>
                <span className="font-mono text-xs text-muted">{clock(e.t)}</span> {e.text}
              </li>
            ))}
          </ul>
        </div>
      )}
      <DiagnosisSection d={d.diagnosis} />

      {d.noFlow > 0 && <p className="text-sm text-red-300">זמן ללא דופק וללא עיסויים: {clock(d.noFlow)}</p>}

      <div className="text-sm">
        <h3 className="mb-1 font-semibold">פרוטוקולים</h3>
        <p className="text-muted">{d.protocols.map((p) => `${p.title} (${p.id})`).join(" · ")}</p>
      </div>

      <details className="text-sm">
        <summary className="cursor-pointer font-semibold">ציר זמן</summary>
        <ol className="mt-2 space-y-0.5 border-s border-line ps-3">
          {d.timeline.map((e, i) => (
            <li key={i}>
              <span className="font-mono text-xs text-muted">{e.t}</span> {e.text}
            </li>
          ))}
        </ol>
      </details>

      <button onClick={onNew} className="btn">
        תרחיש חדש
      </button>
    </section>
  );
}
