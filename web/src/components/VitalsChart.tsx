import { useEffect, useRef, useState } from "react";
import { clock } from "../engine/engine";
import type { VitalsChartData } from "../engine/debrief";
import type { TrendPoint } from "../engine/types";

// The debrief's vitals chart: what the monitor showed over the scenario, one small chart per vital
// (each on its own scale — never two units on one axis), sharing the scenario clock, with the drugs
// and procedures marked on top. Hover / tap shows the values at that moment.

type Row = { key: "hr" | "bp" | "spo2"; title: string; unit: string; color: string; lo: number; hi: number };

const PAD = { l: 8, r: 40 };
const LANE = 36; // event markers and their labels
const ROW_H = 64;
const GAP = 14;
const AXIS = 20;

const pts = (trend: TrendPoint[], k: TrendPoint["k"]) => trend.filter((p) => p.k === k).sort((a, b) => a.t - b.t);

/** A padded, rounded range that always contains the usual normal band, so small changes don't look dramatic. */
function domain(values: number[], normal: [number, number], step: number): [number, number] {
  const lo = Math.min(normal[0], ...values);
  const hi = Math.max(normal[1], ...values);
  return [Math.floor(lo / step) * step, Math.ceil(hi / step) * step];
}

export function VitalsChart({ data }: { data: VitalsChartData }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  // Drawn at its real width, so text stays readable on a phone instead of shrinking with the chart.
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(600);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(300, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [table]);
  const hr = pts(data.trend, "hr");
  const sbp = pts(data.trend, "sbp");
  const dbp = pts(data.trend, "dbp");
  const spo2 = pts(data.trend, "spo2");

  const rows: Row[] = [];
  if (hr.length) rows.push({ key: "hr", title: "דופק", unit: "לדקה", color: "var(--color-ecg)", ...span(domain(hr.map((p) => p.v), [60, 100], 20)) });
  if (sbp.length) rows.push({ key: "bp", title: "לחץ דם", unit: "mmHg", color: "var(--color-nibp)", ...span(domain([...sbp, ...dbp].map((p) => p.v), [60, 140], 20)) });
  if (spo2.length) rows.push({ key: "spo2", title: "סטורציה", unit: "%", color: "var(--color-spo2)", ...span(domain(spo2.map((p) => p.v), [90, 100], 5)) });
  if (!rows.length) return <p className="text-sm text-muted">לא נמדדו מדדים במהלך התרחיש.</p>;

  const end = Math.max(data.end, 60);
  const H = LANE + rows.length * (ROW_H + GAP) + AXIS;
  const x = (t: number) => PAD.l + (t / end) * (W - PAD.l - PAD.r);
  const top = (i: number) => LANE + i * (ROW_H + GAP);
  const y = (row: Row, i: number, v: number) => top(i) + (1 - (v - row.lo) / (row.hi - row.lo)) * ROW_H;
  const tickStep = end <= 300 ? 60 : end <= 900 ? 120 : 300;
  const ticks = Array.from({ length: Math.floor(end / tickStep) + 1 }, (_, k) => k * tickStep);

  // The reading shown at time t: the last one at or before it.
  const at = (list: TrendPoint[], t: number) => [...list].reverse().find((p) => p.t <= t)?.v ?? null;
  const near = hover === null ? [] : data.events.filter((e) => Math.abs(e.t - hover) <= end / 60);

  const line = (list: TrendPoint[], row: Row, i: number) =>
    list.map((p, k) => `${k ? "L" : "M"}${x(p.t).toFixed(1)} ${y(row, i, p.v).toFixed(1)}`).join("");

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">מדדים לאורך התרחיש</h3>
        <button className="text-xs text-muted underline-offset-2 hover:underline" onClick={() => setTable(!table)}>
          {table ? "גרף" : "טבלה"}
        </button>
      </div>
      {table ? (
        <VitalsTable data={data} />
      ) : (
        <div dir="ltr" className="relative" ref={box}>
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="block h-auto w-full touch-none select-none"
            role="img"
            aria-label="מדדים לאורך התרחיש"
            onPointerLeave={() => setHover(null)}
            onPointerMove={(e) => {
              const box = e.currentTarget.getBoundingClientRect();
              const px = ((e.clientX - box.left) / box.width) * W;
              setHover(Math.max(0, Math.min(end, ((px - PAD.l) / (W - PAD.l - PAD.r)) * end)));
            }}
          >
            {/* Event markers: a dot on the top lane and a faint line down through the charts. */}
            {data.events.map((e, k) => (
              <g key={k}>
                <line x1={x(e.t)} x2={x(e.t)} y1={LANE - 8} y2={H - AXIS} stroke="var(--color-muted)" strokeOpacity="0.35" strokeWidth="1" strokeDasharray="2 3" />
                <circle cx={x(e.t)} cy={LANE - 8} r="4" fill="var(--color-ink)" stroke="var(--color-panel)" strokeWidth="2" />
              </g>
            ))}
            {labelled(data.events, x, W).map((e, k) => (
              <text key={k} x={x(e.t)} y={LANE - 18} textAnchor="middle" fontSize="10" fill="var(--color-ink)">
                {e.label}
              </text>
            ))}
            {rows.map((row, i) => (
              <g key={row.key}>
                <rect x={PAD.l} y={top(i)} width={W - PAD.l - PAD.r} height={ROW_H} fill="var(--color-panel-2)" opacity="0.5" rx="4" />
                {[row.lo, row.hi].map((g) => (
                  <text key={g} x={W - PAD.r + 6} y={y(row, i, g)} dominantBaseline="central" fontSize="10" fill="var(--color-muted)">
                    {g}
                  </text>
                ))}
                <text x={W - PAD.r - 6} y={top(i) + 13} fontSize="11" fill="var(--color-muted)" textAnchor="end">
                  {row.title} ({row.unit})
                </text>
                {row.key === "bp" ? (
                  // Each BP reading as a bar from diastolic to systolic.
                  sbp.map((p, k) => {
                    const d = dbp.find((q) => q.t === p.t)?.v ?? p.v;
                    return (
                      <g key={k}>
                        <line x1={x(p.t)} x2={x(p.t)} y1={y(row, i, p.v)} y2={y(row, i, d)} stroke={row.color} strokeWidth="4" strokeLinecap="round" />
                      </g>
                    );
                  })
                ) : (
                  <>
                    <path d={line(row.key === "hr" ? hr : spo2, row, i)} fill="none" stroke={row.color} strokeWidth="2" strokeLinejoin="round" />
                    {(row.key === "hr" ? hr : spo2).map((p, k) => (
                      <circle key={k} cx={x(p.t)} cy={y(row, i, p.v)} r="3" fill={row.color} stroke="var(--color-panel)" strokeWidth="1.5" />
                    ))}
                  </>
                )}
              </g>
            ))}
            {ticks.map((t, k) => (
              <text key={t} x={x(t)} y={H - 6} textAnchor={k === 0 ? "start" : x(t) > W - PAD.r - 20 ? "end" : "middle"} fontSize="10" fill="var(--color-muted)">
                {clock(t)}
              </text>
            ))}
            {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={LANE - 4} y2={H - AXIS} stroke="var(--color-ink)" strokeOpacity="0.6" strokeWidth="1" />}
          </svg>
          {hover !== null && (
            <div
              dir="rtl"
              className="pointer-events-none absolute top-0 z-10 min-w-36 rounded-md border border-line bg-panel-2 px-2.5 py-1.5 text-xs shadow-lg"
              style={{ left: `${(x(hover) / W) * 100}%`, transform: `translateX(${hover > end / 2 ? "-105%" : "5%"})` }}
            >
              <div className="font-mono text-muted">{clock(hover)}</div>
              {hr.length > 0 && <div>דופק: <span className="font-mono">{at(hr, hover) ?? "—"}</span></div>}
              {sbp.length > 0 && (
                <div>
                  לחץ דם: <span className="font-mono">{at(sbp, hover) !== null ? `${at(sbp, hover)}/${at(dbp, hover) ?? "?"}` : "—"}</span>
                </div>
              )}
              {spo2.length > 0 && <div>סטורציה: <span className="font-mono">{at(spo2, hover) !== null ? `${at(spo2, hover)}%` : "—"}</span></div>}
              {near.map((e, k) => (
                <div key={k} className="font-semibold">
                  ● {e.label} <span className="font-mono font-normal text-muted">{clock(e.t)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {data.events.length > 0 && !table && <p className="text-xs text-muted">● = תרופה או פעולה. מעבר עם העכבר (או נגיעה) מציג את הערכים באותו רגע.</p>}
    </div>
  );
}

/** Events whose label fits without overlapping the previous shown label (the rest show on hover). */
function labelled(events: { t: number; label: string }[], x: (t: number) => number, W: number) {
  const out: { t: number; label: string }[] = [];
  let right = -Infinity;
  for (const e of [...events].sort((a, b) => a.t - b.t)) {
    const half = e.label.length * 3.2;
    if (x(e.t) - half < right + 6 || x(e.t) - half < 0 || x(e.t) + half > W) continue;
    out.push(e);
    right = x(e.t) + half;
  }
  return out;
}

function span([lo, hi]: [number, number]) {
  return { lo, hi };
}

/** The same data as a table, for exact values. */
function VitalsTable({ data }: { data: VitalsChartData }) {
  const times = [...new Set([...data.trend.map((p) => p.t), ...data.events.map((e) => e.t)])].sort((a, b) => a - b);
  const val = (t: number, k: TrendPoint["k"]) => data.trend.find((p) => p.t === t && p.k === k)?.v;
  return (
    <div className="max-h-72 overflow-auto rounded-lg border border-line">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-panel-2 text-xs text-muted">
          <tr>
            <th className="px-2 py-1 text-start">זמן</th>
            <th className="px-2 py-1 text-start">דופק</th>
            <th className="px-2 py-1 text-start">לחץ דם</th>
            <th className="px-2 py-1 text-start">סטורציה</th>
            <th className="px-2 py-1 text-start">טיפול</th>
          </tr>
        </thead>
        <tbody>
          {times.map((t) => {
            const s = val(t, "sbp");
            return (
              <tr key={t} className="border-t border-line">
                <td className="px-2 py-1 font-mono text-muted">{clock(t)}</td>
                <td className="px-2 py-1 font-mono">{val(t, "hr") ?? ""}</td>
                <td className="px-2 py-1 font-mono">{s !== undefined ? `${s}/${val(t, "dbp") ?? "?"}` : ""}</td>
                <td className="px-2 py-1 font-mono">{val(t, "spo2") !== undefined ? `${val(t, "spo2")}%` : ""}</td>
                <td className="px-2 py-1">{data.events.filter((e) => e.t === t).map((e) => e.label).join(", ")}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
