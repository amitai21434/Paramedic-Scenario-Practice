import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useAuth } from "../auth";
import { ScoreTrend } from "../components/Score";
import { clock } from "../engine/engine";
import { percent, weakSpots, type ResultRow } from "../lib/history";
import { clearResults, loadResults } from "../lib/results";

const date = (iso: string) => new Date(iso).toLocaleDateString("he-IL", { day: "numeric", month: "numeric", year: "2-digit" });

export default function History() {
  const { session } = useAuth();
  const userId = session?.user.id;
  const [rows, setRows] = useState<ResultRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    if (!userId) return;
    loadResults(userId).then(setRows, (e) => setError(String(e?.message ?? e)));
  }, [userId]);

  const spots = useMemo(() => (rows ? weakSpots(rows) : null), [rows]);

  async function onClear() {
    if (!userId || !confirm("למחוק את כל ההיסטוריה שלך? אי אפשר לשחזר.")) return;
    try {
      await clearResults(userId);
      setRows([]);
    } catch (e) {
      setError(String((e as Error).message));
    }
  }

  return (
    <main dir="rtl" className="mx-auto w-full max-w-3xl space-y-8 px-4 py-6">
      <h1 className="text-lg font-bold">ההיסטוריה שלי</h1>
      {error && <p className="rounded bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">שגיאה: {error}</p>}
      {!rows && !error && <p className="text-sm text-neutral-500">טוען…</p>}
      {rows?.length === 0 && <p className="text-sm text-neutral-500">עוד אין תרחישים שהסתיימו. תרחיש נשמר כאן כשמסיימים אותו.</p>}

      {rows && rows.length >= 2 && (
        <section className="card space-y-2 p-4">
          <h2 className="font-semibold">הציונים שלך לאורך זמן</h2>
          <ScoreTrend points={[...rows].reverse().slice(-30).map((r) => ({ score: percent(r), label: r.title, date: date(r.created_at) }))} />
        </section>
      )}

      {spots && spots.runs > 0 && (
        <section className="card space-y-4 p-4">
          <h2 className="font-semibold">נקודות לחיזוק ({spots.runs} תרחישים)</h2>
          <Block title="פעולות שהכי הרבה מפספסים">
            {spots.missed.map((m) => (
              <li key={m.label}>
                <span className={m.critical ? "font-medium text-red-700 dark:text-red-400" : ""}>{m.label}</span>{" "}
                <span className="text-xs text-neutral-500">
                  — נשכח ב־{m.missed} מתוך {m.of}
                </span>
              </li>
            ))}
          </Block>
          <Block title="טעויות חוזרות">
            {spots.errors.map((e) => (
              <li key={e.text}>
                {e.text} <span className="text-xs text-neutral-500">×{e.count}</span>
              </li>
            ))}
          </Block>
          <Block title="פעולות שבוצעו באיחור">
            {spots.late.map((l) => (
              <li key={l.label}>
                {l.label} <span className="text-xs text-neutral-500">×{l.count}</span>
              </li>
            ))}
          </Block>
          <Block title="ציון ממוצע לפי תחנה">
            {spots.stations.map((s) => (
              <li key={s.station}>
                {s.station}: {s.avg}% <span className="text-xs text-neutral-500">({s.runs} תרחישים)</span>
              </li>
            ))}
          </Block>
          <Block title="התרחישים עם הציון הנמוך ביותר">
            {spots.storylines.map((s) => (
              <li key={s.title}>
                {s.title}: {s.avg}% <span className="text-xs text-neutral-500">({s.runs})</span>
              </li>
            ))}
          </Block>
        </section>
      )}

      {rows && rows.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-semibold">תרחישים שהסתיימו</h2>
          <ul className="divide-y divide-neutral-200 rounded border border-neutral-200 text-sm dark:divide-neutral-800 dark:border-neutral-800">
            {rows.map((r) => (
              <li key={r.id} className="px-3 py-2">
                <button className="flex w-full items-baseline gap-3 text-start" onClick={() => setOpen(open === r.id ? null : r.id)}>
                  <span className="text-neutral-500">{date(r.created_at)}</span>
                  <span className="flex-1">{r.title}</span>
                  <span className="tabular-nums">
                    {r.score_done}/{r.score_total} ({percent(r)}%)
                  </span>
                  {r.critical_missed > 0 && <span className="text-red-600">{r.critical_missed} קריטיות</span>}
                </button>
                {open === r.id && <ResultDetailsView r={r} />}
              </li>
            ))}
          </ul>
          <button onClick={onClear} className="text-sm text-red-700 hover:underline dark:text-red-400">
            מחיקת כל ההיסטוריה שלי
          </button>
        </section>
      )}
    </main>
  );
}

function Block({ title, children }: { title: string; children: ReactNode[] }) {
  if (!children.length) return null;
  return (
    <div>
      <h3 className="mb-1 text-sm font-medium text-neutral-600 dark:text-neutral-400">{title}</h3>
      <ul className="list-disc space-y-0.5 ps-5 text-sm">{children}</ul>
    </div>
  );
}

function ResultDetailsView({ r }: { r: ResultRow }) {
  const d = r.details;
  return (
    <div className="mt-2 space-y-2 border-s-2 border-neutral-200 ps-3 dark:border-neutral-800">
      <p className="text-xs text-neutral-500">
        {r.station} · משך {clock(r.duration_sec)}
        {d.complication && ` · סיבוך: ${d.complication.title} (${d.complication.resolved ? "טופל" : "לא טופל"})`}
      </p>
      <ul className="space-y-0.5">
        {d.checklist.map((c, i) => (
          <li key={i} className="flex gap-2">
            <span aria-hidden>{!c.done ? (c.critical ? "❌" : "⬜") : c.late ? "⚠️" : "✅"}</span>
            <span>{c.label}</span>
          </li>
        ))}
      </ul>
      {d.errors.length > 0 && (
        <ul className="space-y-0.5 text-red-700 dark:text-red-400">
          {d.errors.map((e, i) => (
            <li key={i}>✗ {e}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
