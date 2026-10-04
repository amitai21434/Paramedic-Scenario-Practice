// Synthetic ECG: a beat schedule for the rhythm (when P waves and QRS
// complexes happen), then each lead's waveform built from Gaussian bumps.
// The student reads the strip — the rhythm's name is never shown.
// Units: seconds and millivolts (1 small square = 0.04 s × 0.1 mV).

import { rng } from "./generate";
import type { EcgSnapshot } from "./types";

export const HZ = 200;

type Beat = { t: number; wide: boolean; paced?: boolean };
type Schedule = { p: number[]; qrs: Beat[]; baseline: (t: number) => number };

const gauss = (t: number, c: number, w: number, a: number) => a * Math.exp(-((t - c) ** 2) / (2 * w * w));
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

/** Lead shape: R/S size, T size, P size. aVR is the inverted mirror of II. */
const LEADS: Record<string, { r: number; s: number; t: number; p: number }> = {
  I: { r: 0.7, s: 0.1, t: 0.25, p: 0.08 },
  II: { r: 1.0, s: 0.25, t: 0.3, p: 0.12 },
  III: { r: 0.5, s: 0.2, t: 0.12, p: 0.06 },
  aVR: { r: -0.8, s: -0.1, t: -0.25, p: -0.09 },
  aVL: { r: 0.4, s: 0.3, t: 0.1, p: 0.04 },
  aVF: { r: 0.75, s: 0.2, t: 0.2, p: 0.09 },
  V1: { r: 0.2, s: 1.0, t: 0.05, p: 0.06 },
  V2: { r: 0.35, s: 1.3, t: 0.4, p: 0.07 },
  V3: { r: 0.7, s: 0.8, t: 0.45, p: 0.08 },
  V4: { r: 1.2, s: 0.5, t: 0.45, p: 0.08 },
  V5: { r: 1.3, s: 0.25, t: 0.35, p: 0.08 },
  V6: { r: 1.0, s: 0.15, t: 0.3, p: 0.08 },
  V3R: { r: 0.25, s: 0.8, t: 0.15, p: 0.06 },
  V4R: { r: 0.2, s: 0.6, t: 0.1, p: 0.06 },
  V5R: { r: 0.2, s: 0.5, t: 0.1, p: 0.05 },
  V7: { r: 0.6, s: 0.1, t: 0.2, p: 0.06 },
  V8: { r: 0.5, s: 0.1, t: 0.15, p: 0.05 },
  V9: { r: 0.4, s: 0.1, t: 0.12, p: 0.05 },
};

export const LAYOUT_12 = [
  ["I", "aVR", "V1", "V4"],
  ["II", "aVL", "V2", "V5"],
  ["III", "aVF", "V3", "V6"],
];
export const LAYOUT_RIGHT = [
  ["V3R", "V4R", "V5R"],
  ["V7", "V8", "V9"],
];

function schedule(snap: EcgSnapshot, duration: number): Schedule {
  const r = rng(snap.seed);
  const hr = Math.max(snap.hr, 1);
  const rr = 60 / hr;
  const p: number[] = [];
  const qrs: Beat[] = [];
  let baseline = (_t: number) => 0;
  const start = -r.next() * rr;
  const jitter = () => 1 + (r.next() - 0.5) * 0.04;

  switch (snap.rhythm) {
    case "vf": {
      const parts = Array.from({ length: 5 }, () => ({ f: 3 + r.next() * 4, ph: r.next() * 6.28, a: 0.15 + r.next() * 0.25 }));
      const env = 0.6 + r.next() * 0.6;
      baseline = (t) => parts.reduce((s, x) => s + x.a * Math.sin(6.28 * x.f * t + x.ph), 0) * (0.6 + 0.4 * Math.sin(t * env));
      break;
    }
    case "asystole":
      baseline = (t) => 0.03 * Math.sin(t * 1.3) + 0.01 * Math.sin(t * 7);
      break;
    case "afib": {
      for (let t = start; t < duration + 1; t += rr * (0.6 + r.next() * 0.8)) qrs.push({ t, wide: snap.wide });
      const parts = Array.from({ length: 4 }, () => ({ f: 5 + r.next() * 4, ph: r.next() * 6.28 }));
      baseline = (t) => parts.reduce((s, x) => s + 0.025 * Math.sin(6.28 * x.f * t + x.ph), 0);
      break;
    }
    case "aflutter": {
      const ff = 0.2; // 300/min
      baseline = (t) => -0.15 * (((t / ff) % 1) - 0.5) * 2 * 0.5;
      const ratio = Math.max(2, Math.round(rr / ff));
      for (let t = start; t < duration + 1; t += ff * ratio) qrs.push({ t, wide: snap.wide });
      break;
    }
    case "avb2-1": {
      // Wenckebach 4:3 — PR lengthens until a P wave isn't conducted.
      const pp = (rr * 3) / 4;
      const prs = [0.16, 0.26, 0.34];
      for (let k = 0, t = start; t < duration + 1; k++, t += pp) {
        p.push(t);
        if (k % 4 < 3) qrs.push({ t: t + prs[k % 4], wide: snap.wide });
      }
      break;
    }
    case "avb2-2": {
      // Mobitz II 2:1 with a fixed PR.
      const pp = rr / 2;
      for (let k = 0, t = start; t < duration + 1; k++, t += pp) {
        p.push(t);
        if (k % 2 === 0) qrs.push({ t: t + 0.18, wide: snap.wide });
      }
      break;
    }
    case "avb3": {
      const pp = 60 / (70 + r.next() * 15);
      for (let t = start * 0.7; t < duration + 1; t += pp) p.push(t);
      for (let t = start; t < duration + 1; t += rr * jitter()) qrs.push({ t, wide: true });
      break;
    }
    default: {
      const pr = snap.rhythm === "avb1" ? 0.32 : 0.16;
      const hasP = !["junctional", "svt", "vt", "torsades", "paced"].includes(snap.rhythm);
      for (let t = start; t < duration + 1; t += rr * jitter()) {
        if (hasP) p.push(t - pr);
        qrs.push({ t, wide: snap.wide, paced: snap.rhythm === "paced" });
      }
      if (snap.rhythm === "paced") {
        // Atria still beat on their own (complete block underneath).
        const pp = 60 / 75;
        for (let t = start * 0.5; t < duration + 1; t += pp) p.push(t);
      }
    }
  }
  return { p, qrs, baseline };
}

function beatAt(t: number, b: Beat, lead: (typeof LEADS)[string], st: number, rr: number, rhythm: string): number {
  const dt = t - b.t;
  if (dt < -0.3 || dt > 0.7) return 0;
  if (rhythm === "vt" || rhythm === "torsades") {
    // Wide (~0.16 s) monomorphic complexes: a steep tall R with a slurred
    // downstroke, then a broad opposite-direction ST-T merging into the next beat.
    const pol = Math.sign(lead.r || 1);
    const tw = Math.min(0.09, rr * 0.22);
    return (
      gauss(dt, -0.02, 0.018, 0.5 * pol) +
      gauss(dt, 0.02, 0.03, 1.1 * pol) +
      gauss(dt, 0.08, 0.025, -0.35 * pol) +
      gauss(dt, Math.min(0.2, rr * 0.55), tw, -0.55 * pol)
    );
  }
  const qt = 0.16 + 0.12 * Math.sqrt(rr);
  let v = 0;
  if (b.paced) v += gauss(dt, -0.045, 0.002, 1.2);
  if (b.wide) {
    v += gauss(dt, 0, 0.03, lead.r * 1.1) + gauss(dt, 0.07, 0.03, -lead.s * 0.9 - 0.2) + gauss(dt, qt, 0.07, -lead.t * 0.9);
  } else {
    v += gauss(dt, -0.025, 0.008, -0.06 * Math.sign(lead.r)) + gauss(dt, 0, 0.011, lead.r) + gauss(dt, 0.028, 0.011, -lead.s) + gauss(dt, qt, 0.055, lead.t);
  }
  // ST deviation: a plateau from the J point into the T wave.
  if (st) v += st * 0.1 * (sigmoid((dt - 0.05) / 0.008) - sigmoid((dt - (qt + 0.05)) / 0.03));
  return v;
}

/** Samples of one lead over [from, from + seconds). */
export function leadSamples(snap: EcgSnapshot, leadName: string, from: number, seconds: number, sched?: Schedule): number[] {
  const s = sched ?? schedule(snap, from + seconds);
  const lead = LEADS[leadName] ?? LEADS.II;
  const st = snap.st[leadName] ?? 0;
  const rr = 60 / Math.max(snap.hr, 1);
  const n = Math.round(seconds * HZ);
  const out = new Array<number>(n);
  const noise = rng(snap.seed + leadName.length);
  for (let i = 0; i < n; i++) {
    const t = from + i / HZ;
    let v = s.baseline(t) * Math.abs(lead.r || 1);
    if (snap.rhythm === "torsades") v = 0;
    for (const pt of s.p) {
      if (Math.abs(t - pt) < 0.15) v += gauss(t, pt, 0.025, lead.p);
    }
    for (const b of s.qrs) {
      let bv = beatAt(t, b, lead, st, rr, snap.rhythm);
      if (snap.rhythm === "torsades") bv *= 0.5 + 0.5 * Math.abs(Math.sin((t * Math.PI) / 2.2));
      v += bv;
    }
    if (snap.mode === "cpr") v = v * 0.3 + 1.1 * Math.sin(6.28 * 1.8 * t) + 0.25 * Math.sin(6.28 * 5.4 * t);
    out[i] = v + (noise.next() - 0.5) * 0.015;
  }
  return out;
}

export function makeSchedule(snap: EcgSnapshot, seconds: number) {
  return schedule(snap, seconds);
}
