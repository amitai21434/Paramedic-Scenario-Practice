import { useState } from "react";

/** The debrief's headline number: share of protocol steps done, as a ring. */
export function ScoreRing({ value, size = 104 }: { value: number; size?: number }) {
  const r = 42;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, value));
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} role="img" aria-label={`ציון ${pct}%`} className="shrink-0">
      <circle cx="50" cy="50" r={r} fill="none" stroke="var(--color-line)" strokeWidth="8" />
      <circle
        cx="50"
        cy="50"
        r={r}
        fill="none"
        stroke="var(--color-ecg)"
        strokeWidth="8"
        strokeLinecap="round"
        strokeDasharray={`${(pct / 100) * c} ${c}`}
        transform="rotate(-90 50 50)"
        style={{ transition: "stroke-dasharray 600ms ease-out" }}
      />
      <text x="50" y="50" textAnchor="middle" dominantBaseline="central" fill="var(--color-ink)" fontSize="24" fontWeight="800" fontFamily="var(--font-mono)">
        {pct}%
      </text>
    </svg>
  );
}

export type TrendPoint = { score: number; label: string; date: string };

/** Score per finished scenario over time, read right to left (oldest on the right), with a hover readout. */
export function ScoreTrend({ points }: { points: TrendPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  if (points.length < 2) return null;
  const W = 600;
  const H = 160;
  const pad = { l: 12, r: 38, t: 12, b: 20 };
  const x = (i: number) => W - pad.r - (i / (points.length - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - v / 100) * (H - pad.t - pad.b);
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p.score).toFixed(1)}`).join("");
  const h = hover !== null ? points[hover] : null;

  return (
    <div dir="ltr" className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block h-auto w-full"
        role="img"
        aria-label="מגמת ציונים"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - box.left) / box.width) * W;
          const i = Math.round(((W - pad.r - px) / (W - pad.l - pad.r)) * (points.length - 1));
          setHover(Math.max(0, Math.min(points.length - 1, i)));
        }}
      >
        {[0, 50, 100].map((g) => (
          <g key={g}>
            <line x1={pad.l} x2={W - pad.r} y1={y(g)} y2={y(g)} stroke="var(--color-line)" strokeWidth="1" />
            <text x={W - pad.r + 6} y={y(g)} textAnchor="start" dominantBaseline="central" fontSize="10" fill="var(--color-muted)">
              {g}%
            </text>
          </g>
        ))}
        <path d={d} fill="none" stroke="var(--color-ecg)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => (
          <circle key={i} cx={x(i)} cy={y(p.score)} r={hover === i ? 5 : 3} fill="var(--color-ecg)" stroke="var(--color-panel)" strokeWidth="2" />
        ))}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} stroke="var(--color-muted)" strokeWidth="1" strokeDasharray="3 3" />}
      </svg>
      {h && (
        <div
          dir="rtl"
          className="pointer-events-none absolute top-0 rounded-md border border-line bg-panel-2 px-2 py-1 text-xs shadow-lg"
          style={{ left: `${(x(hover!) / W) * 100}%`, transform: "translateX(-50%)" }}
        >
          <span className="font-mono font-bold">{h.score}%</span> · {h.label} · <span className="text-muted">{h.date}</span>
        </div>
      )}
    </div>
  );
}
