import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { MonitorStrip, PaperStrip, TwelveLead } from "../components/Ecg";
import { debrief } from "../engine/debrief";
import { clock, ecgSnapshot, pickTemplate, rollComplication, startSim, step } from "../engine/engine";
import { effectiveVitals } from "../engine/physiology";
import type { Content, Message, Sim } from "../engine/types";
import { loadContent, logUnrecognized } from "../lib/content";
import { saveResult } from "../lib/results";

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
  const [station, setStation] = useState("");
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

  function newScenario() {
    if (!content) return;
    if (sim && !sim.ended && sim.messages.length > 2 && !confirm("להתחיל תרחיש חדש? התרחיש הנוכחי יימחק.")) return;
    const recent = load<string[]>(RECENT_KEY) ?? [];
    const id = pickTemplate(content, station || null, recent);
    const seed = crypto.getRandomValues(new Uint32Array(1))[0];
    save(RECENT_KEY, [id, ...recent].slice(0, 2));
    update(startSim(content, id, seed, undefined, rollComplication(content, id, seed)));
    setInput("");
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

  const available = new Set(content?.cases.map((c) => c.station));

  return (
    <main dir="rtl" className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 pb-4">
      <div className="flex flex-wrap items-center gap-2 py-3">
        <h1 className="me-auto text-lg font-semibold">תרגול תרחישים</h1>
        {sim && !sim.ended && (
          <span className="rounded bg-neutral-100 px-2 py-1 font-mono text-sm tabular-nums dark:bg-neutral-900" title="זמן בתרחיש">
            ⏱ {clock(sim.t)}
          </span>
        )}
        <select value={station} onChange={(e) => setStation(e.target.value)} className="input" aria-label="תחנה">
          <option value="">כל התחנות</option>
          {STATIONS.map((s) => (
            <option key={s} value={s} disabled={!available.has(s)}>
              {s}
              {available.has(s) ? "" : " (בקרוב)"}
            </option>
          ))}
        </select>
        <button onClick={newScenario} disabled={!content} className="btn">
          תרחיש חדש
        </button>
      </div>

      {loadError && (
        <p className="rounded bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          לא הצלחתי לטעון את התרחישים: {loadError}
        </p>
      )}
      {!sim && !loadError && (
        <div className="rounded border border-dashed border-neutral-300 p-4 text-sm leading-relaxed text-neutral-600 dark:border-neutral-700 dark:text-neutral-400">
          <p>
            בחרי תחנה (או &quot;כל התחנות&quot;) ולחצי <strong>תרחיש חדש</strong>.
          </p>
          <p>
            כתבי מה את עושה, במילים שלך — למשל &quot;מחברת מוניטור ומודדת לחץ דם&quot;, &quot;אספירין 300 מ&quot;ג&quot;,
            &quot;מה קרה?&quot;. בסוף כתבי &quot;פינוי&quot; ו־&quot;סיום&quot; כדי לקבל משוב.
          </p>
          <p>
            אפשר גם לומר אבחנה או קריאת אק&quot;ג — &quot;חושדת ב־STEMI תחתון&quot;, &quot;הקצב הוא חסם מלא&quot; — והיא תופיע במשוב.
          </p>
        </div>
      )}

      {sim && content && (
        <div className="flex flex-1 flex-col gap-4 md:flex-row-reverse md:items-start">
          <aside className="md:sticky md:top-4 md:w-72 md:shrink-0">
            <MonitorPanel sim={sim} />
          </aside>
          <section className="flex min-w-0 flex-1 flex-col">
            <div className="flex-1 space-y-3 pb-4">
              {sim.messages.map((m, i) => (
                <Bubble key={i} m={m} />
              ))}
              {sim.ended && <DebriefView content={content} sim={sim} onNew={newScenario} />}
              <div ref={bottomRef} />
            </div>
            {!sim.ended && (
              <form onSubmit={onSubmit} className="sticky bottom-0 flex items-end gap-2 border-t border-neutral-200 bg-[var(--background)] pt-3 dark:border-neutral-800">
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
                  <button type="button" onClick={() => send("סיום")} className="rounded border border-neutral-300 px-3 py-1 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900">
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

function Bubble({ m }: { m: Message }) {
  if (m.from === "user") {
    return (
      <div className="flex justify-start">
        <div dir="auto" className="max-w-[85%] whitespace-pre-wrap rounded-lg bg-neutral-900 px-3 py-2 text-[15px] text-white dark:bg-neutral-100 dark:text-neutral-900">
          {m.text}
        </div>
      </div>
    );
  }
  if ("ecg" in m) {
    return (
      <figure className="space-y-1">
        <figcaption className="text-xs text-neutral-500">
          {clock(m.t)} · {m.caption}
        </figcaption>
        <div dir="ltr" className="overflow-x-auto rounded border border-neutral-200 dark:border-neutral-800">
          {m.ecg.mode === "12" || m.ecg.mode === "right" ? <TwelveLead snap={m.ecg} /> : <PaperStrip snap={m.ecg} />}
        </div>
      </figure>
    );
  }
  return (
    <div className="flex justify-end">
      <div dir="auto" className="max-w-[85%] whitespace-pre-wrap rounded-lg bg-neutral-100 px-3 py-2 text-[15px] leading-relaxed dark:bg-neutral-900">
        <span className="me-2 font-mono text-xs text-neutral-400">{clock(m.t)}</span>
        {m.text}
      </div>
    </div>
  );
}

function MonitorPanel({ sim }: { sim: Sim }) {
  const flags = new Set(sim.flags);
  const v = effectiveVitals(sim);
  const bp = sim.measured.sbp;
  const dbp = sim.measured.dbp;
  const extras = (["rr", "glucose", "temp", "gcs"] as const).filter((k) => sim.measured[k]);
  const labels = { rr: "נשימות", glucose: "סוכר", temp: "חום", gcs: "GCS" };

  if (!flags.has("monitor")) {
    return (
      <div className="rounded border border-neutral-200 p-3 text-sm text-neutral-500 dark:border-neutral-800">
        מוניטור לא מחובר
        {bp && (
          <p className="mt-2 text-neutral-700 dark:text-neutral-300">
            לחץ דם אחרון: {bp.value === null ? "—" : `${bp.value}/${dbp?.value}`} ({clock(bp.t)})
          </p>
        )}
      </div>
    );
  }
  const snap = ecgSnapshot(sim, flags.has("cpr") ? "cpr" : "strip");
  const hr = flags.has("cpr") ? "--" : v.hr === null ? "---" : v.hr;
  return (
    <div dir="ltr" className="overflow-hidden rounded-lg bg-black font-mono text-white shadow">
      <MonitorStrip snap={snap} seconds={5} />
      <div className="grid grid-cols-2 gap-px bg-neutral-800 text-center">
        <Reading label="HR" value={hr} color="text-green-400" />
        <Reading label="SpO2" value={flags.has("spo2probe") ? (v.spo2 === null ? "---" : v.spo2) : "—"} color="text-cyan-300" unit="%" />
        <Reading
          label={`NIBP${bp ? ` ${clock(bp.t)}` : ""}`}
          value={bp ? (bp.value === null ? "---" : `${bp.value}/${dbp?.value}`) : "—"}
          color="text-red-300"
        />
        <Reading label="EtCO2" value={flags.has("capno") ? (v.etco2 ?? "---") : "—"} color="text-yellow-300" />
      </div>
      {extras.length > 0 && (
        <div dir="rtl" className="flex flex-wrap gap-x-3 gap-y-1 bg-neutral-900 px-3 py-2 text-xs text-neutral-300">
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

/** Diagnosis and ECG reading — informational only, not part of the score. */
function DiagnosisSection({ d }: { d: ReturnType<typeof debrief>["diagnosis"] }) {
  const rows = [...d.items, ...d.rhythms.map((r) => ({ ...r, label: `קצב: ${r.label}` }))];
  if (!rows.length && !d.unmatched.length) return null;
  return (
    <div>
      <h3 className="mb-1 font-semibold">אבחנה וקריאת אק&quot;ג</h3>
      <p className="mb-2 text-xs text-neutral-500">למידע בלבד — לא נספר בציון.</p>
      <ul className="space-y-1 text-sm">
        {rows.map((r, i) => (
          <li key={i} className="flex gap-2">
            <span aria-hidden>{r.statedAt === null ? "▫️" : "✅"}</span>
            <span className={r.statedAt === null ? "text-neutral-500" : ""}>
              {r.label}
              {r.statedAt === null ? (
                <span className="ms-1 text-xs">— לא נאמר</span>
              ) : (
                <span className="ms-1 font-mono text-xs text-neutral-500">({clock(r.statedAt)})</span>
              )}
            </span>
          </li>
        ))}
        {d.unmatched.map((u, i) => (
          <li key={`u${i}`} className="flex gap-2 text-neutral-600 dark:text-neutral-400">
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

function Reading({ label, value, color, unit }: { label: string; value: string | number; color: string; unit?: string }) {
  return (
    <div className="bg-black px-2 py-1.5">
      <div className="text-[10px] text-neutral-400">{label}</div>
      <div className={`text-2xl leading-tight tabular-nums ${color}`}>
        {value}
        {unit && value !== "—" && value !== "---" && <span className="text-xs">{unit}</span>}
      </div>
    </div>
  );
}

function DebriefView({ content, sim, onNew }: { content: Content; sim: Sim; onNew: () => void }) {
  const d = debrief(content, sim);
  return (
    <section className="space-y-4 rounded-lg border border-neutral-300 p-4 dark:border-neutral-700">
      <div>
        <p className="text-xs text-neutral-500">האבחנה</p>
        <h2 className="text-lg font-semibold">{d.title}</h2>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">{d.patient}</p>
        <p className="mt-1 text-sm">{d.outcome}</p>
        {sim.saved === "saved" && <p className="text-xs text-neutral-500">✓ נשמר בהיסטוריה שלך</p>}
        {d.complication && (
          <p className="mt-1 text-sm">
            ⚡ סיבוך במהלך התרחיש: {d.complication.title} ({clock(d.complication.at)})
            {d.complication.resolvedAt !== null ? ` — טופל ב־${clock(d.complication.resolvedAt)}` : " — לא טופל"}
          </p>
        )}
      </div>

      <div>
        <h3 className="mb-2 font-semibold">
          לפי הפרוטוקול — {d.score.done}/{d.score.total}
          {d.score.criticalMissed > 0 && <span className="ms-2 text-sm font-normal text-red-600">({d.score.criticalMissed} פעולות קריטיות חסרות)</span>}
        </h3>
        <ul className="space-y-1 text-sm">
          {d.checklist.map((c, i) => (
            <li key={i} className="flex gap-2">
              <span aria-hidden>{c.doneAt === null ? (c.critical ? "❌" : "⬜") : c.late ? "⚠️" : "✅"}</span>
              <span className={c.doneAt === null && c.critical ? "font-medium text-red-700 dark:text-red-400" : ""}>
                {c.label}
                {c.doneAt !== null && <span className="ms-1 font-mono text-xs text-neutral-500">({clock(c.doneAt)}{c.late ? " — באיחור" : ""})</span>}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {d.errors.length > 0 && (
        <div>
          <h3 className="mb-2 font-semibold text-red-700 dark:text-red-400">טעויות</h3>
          <ul className="space-y-1 text-sm">
            {d.errors.map((e, i) => (
              <li key={i}>
                <span className="font-mono text-xs text-neutral-500">{clock(e.t)}</span> {e.text}
              </li>
            ))}
          </ul>
        </div>
      )}
      {d.warnings.length > 0 && (
        <div>
          <h3 className="mb-2 font-semibold text-amber-700 dark:text-amber-400">הערות</h3>
          <ul className="space-y-1 text-sm">
            {d.warnings.map((e, i) => (
              <li key={i}>
                <span className="font-mono text-xs text-neutral-500">{clock(e.t)}</span> {e.text}
              </li>
            ))}
          </ul>
        </div>
      )}
      <DiagnosisSection d={d.diagnosis} />

      {d.noFlow > 0 &&<p className="text-sm text-red-700 dark:text-red-400">זמן ללא דופק וללא עיסויים: {clock(d.noFlow)}</p>}

      <div className="text-sm">
        <h3 className="mb-1 font-semibold">פרוטוקולים</h3>
        <p className="text-neutral-600 dark:text-neutral-400">{d.protocols.map((p) => `${p.title} (${p.id})`).join(" · ")}</p>
      </div>

      <details className="text-sm">
        <summary className="cursor-pointer font-semibold">ציר זמן</summary>
        <ol className="mt-2 space-y-0.5">
          {d.timeline.map((e, i) => (
            <li key={i}>
              <span className="font-mono text-xs text-neutral-500">{e.t}</span> {e.text}
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
