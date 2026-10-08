import { useEffect, useId, useMemo, useRef } from "react";
import { HZ, LAYOUT_12, LAYOUT_RIGHT, leadSamples, makeSchedule } from "../engine/ecg";
import type { EcgSnapshot } from "../engine/types";

// Drawn at standard paper speed: 25 mm/s, 10 mm/mV, 4 px per mm.
const PX_MM = 4;
const PX_S = 25 * PX_MM;
const PX_MV = 10 * PX_MM;

function path(samples: number[], x0: number, y0: number): string {
  let d = "";
  for (let i = 0; i < samples.length; i++) {
    const x = x0 + (i / HZ) * PX_S;
    const y = y0 - samples[i] * PX_MV;
    d += `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  return d;
}

function Paper({ width, height }: { width: number; height: number }) {
  const id = useId();
  return (
    <>
      <defs>
        <pattern id={`${id}s`} width={PX_MM} height={PX_MM} patternUnits="userSpaceOnUse">
          <path d={`M ${PX_MM} 0 L 0 0 0 ${PX_MM}`} fill="none" stroke="#f3b6b6" strokeWidth="0.4" />
        </pattern>
        <pattern id={`${id}b`} width={PX_MM * 5} height={PX_MM * 5} patternUnits="userSpaceOnUse">
          <rect width={PX_MM * 5} height={PX_MM * 5} fill={`url(#${id}s)`} />
          <path d={`M ${PX_MM * 5} 0 L 0 0 0 ${PX_MM * 5}`} fill="none" stroke="#e58a8a" strokeWidth="0.8" />
        </pattern>
      </defs>
      <rect width={width} height={height} fill="#fff7f7" />
      <rect width={width} height={height} fill={`url(#${id}b)`} />
    </>
  );
}

/** The monitor's lead II trace: green on black. */
export function MonitorStrip({ snap, seconds = 6 }: { snap: EcgSnapshot; seconds?: number }) {
  const width = seconds * PX_S;
  const height = 30 * PX_MM;
  const d = useMemo(() => path(leadSamples(snap, "II", 0, seconds), 0, height * 0.6), [snap, seconds, height]);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="block h-auto w-full" role="img" aria-label="רצועת קצב">
      <rect width={width} height={height} fill="#050a06" />
      <path d={d} fill="none" stroke="#3ee07a" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

/** A printed rhythm strip (lead II) on ECG paper. */
export function PaperStrip({ snap, seconds = 6 }: { snap: EcgSnapshot; seconds?: number }) {
  const width = seconds * PX_S;
  const height = 30 * PX_MM;
  const d = useMemo(() => path(leadSamples(snap, "II", 0, seconds), 0, height * 0.6), [snap, seconds, height]);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="block h-auto w-full min-w-[480px]" role="img" aria-label="רצועת קצב">
      <Paper width={width} height={height} />
      <text x="6" y="14" fontSize="11" fill="#333">II</text>
      <path d={d} fill="none" stroke="#111" strokeWidth="1.1" strokeLinejoin="round" />
    </svg>
  );
}

/** 12-lead (or right/posterior leads) in the standard grid, with a lead II rhythm strip under the 12-lead. */
export function TwelveLead({ snap }: { snap: EcgSnapshot }) {
  const right = snap.mode === "right";
  const layout = right ? LAYOUT_RIGHT : LAYOUT_12;
  const seg = 2.5;
  const cols = layout[0].length;
  const rowH = 25 * PX_MM;
  const width = cols * seg * PX_S;
  const rows = layout.length + (right ? 0 : 1);
  const height = rows * rowH;

  const paths = useMemo(() => {
    const sched = makeSchedule(snap, cols * seg);
    const out: { d: string; label: string; x: number; y: number }[] = [];
    layout.forEach((row, r) =>
      row.forEach((lead, c) => {
        const x = c * seg * PX_S;
        const y = r * rowH + rowH * 0.6;
        out.push({ d: path(leadSamples(snap, lead, c * seg, seg, sched), x, y), label: lead, x, y: r * rowH });
      }),
    );
    if (!right) {
      const y = layout.length * rowH + rowH * 0.6;
      out.push({ d: path(leadSamples(snap, "II", 0, cols * seg, sched), 0, y), label: "II", x: 0, y: layout.length * rowH });
    }
    return out;
  }, [snap, layout, cols, rowH, right]);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="block h-auto w-full min-w-[640px]" role="img" aria-label="אק״ג">
      <Paper width={width} height={height} />
      {paths.map((p, i) => (
        <g key={i}>
          <path d={p.d} fill="none" stroke="#111" strokeWidth="1" strokeLinejoin="round" />
          <text x={p.x + 6} y={p.y + 14} fontSize="12" fontWeight="600" fill="#333">
            {p.label}
          </text>
          {p.x > 0 && <line x1={p.x} x2={p.x} y1={p.y + rowH * 0.35} y2={p.y + rowH * 0.85} stroke="#111" strokeWidth="1" />}
        </g>
      ))}
    </svg>
  );
}

/**
 * The monitor's live lead II: the trace is drawn left to right like a real defibrillator
 * screen, erasing just ahead of the sweep. `onBeat` fires on each QRS (for the heart icon).
 */
export function LiveMonitor({ snap, seconds = 5, onBeat }: { snap: EcgSnapshot; seconds?: number; onBeat?: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const beatRef = useRef(onBeat);
  beatRef.current = onBeat;
  // A 12-second loop of samples and the beat times inside it.
  const data = useMemo(() => {
    const loop = 12;
    const sched = makeSchedule(snap, loop);
    return {
      loop,
      samples: leadSamples(snap, "II", 0, loop, sched),
      beats: snap.mode === "cpr" ? [] : sched.qrs.map((b) => b.t).filter((t) => t >= 0 && t < loop),
    };
  }, [snap]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const { loop, samples, beats } = data;
    const valueAt = (t: number) => samples[Math.floor((((t % loop) + loop) % loop) * HZ)] ?? 0;

    let raf = 0;
    let prev = 0;
    const start = performance.now();
    const draw = (now: number) => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const t = reduced ? seconds : (now - start) / 1000;
      const head = ((t % seconds) / seconds) * w;
      const gap = w * 0.04;
      const mid = h * 0.62;
      const scale = h * 0.32;

      ctx.fillStyle = "#020604";
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = "rgba(62,224,122,0.07)";
      ctx.lineWidth = 1;
      for (let x = 0; x < w; x += w / 10) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }

      ctx.strokeStyle = "#3ee07a";
      ctx.lineWidth = 1.8;
      ctx.lineJoin = "round";
      ctx.shadowColor = "rgba(62,224,122,0.6)";
      ctx.shadowBlur = 4;
      ctx.beginPath();
      let pen = false;
      for (let x = 0; x <= w; x += 1) {
        // Columns just ahead of the sweep are erased; behind it is the newest trace, ahead the previous sweep.
        if (!reduced && x > head && x < head + gap) {
          pen = false;
          continue;
        }
        const age = x <= head ? (head - x) / w : (head + w - x) / w;
        const y = mid - valueAt(t - age * seconds) * scale;
        if (pen) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
        pen = true;
      }
      ctx.stroke();
      ctx.shadowBlur = 0;

      if (!reduced) {
        const a = prev % loop;
        const b = t % loop;
        if (beats.some((bt) => (a <= b ? bt > a && bt <= b : bt > a || bt <= b))) beatRef.current?.();
        prev = t;
        raf = requestAnimationFrame(draw);
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [data, seconds]);

  return <canvas ref={ref} className="block h-28 w-full" role="img" aria-label="מוניטור — רצועת קצב חיה" />;
}
