// Finished-scenario history: what is saved when a scenario ends, and the
// "weak spots" summary computed from a student's saved results. Pure — the
// database calls are in results.ts.

import { debrief, scorePct, stepCredit } from "../engine/debrief";
import type { Content, Message, Sim } from "../engine/types";

export type ResultDetails = {
  checklist: { label: string; critical: boolean; done: boolean; late: boolean }[];
  errors: string[];
  warnings: string[];
  complication: { title: string; resolved: boolean } | null;
};

export type ResultRow = {
  id: number;
  user_id: string;
  scenario: string;
  title: string;
  station: string;
  score_done: number;
  score_total: number;
  critical_missed: number;
  duration_sec: number;
  details: ResultDetails;
  created_at: string;
};

export type NewResult = Omit<ResultRow, "id" | "user_id" | "created_at">;

/** The whole run, kept only for users the admin picked (profiles.keep_transcripts). */
export type Transcript = {
  v: 1;
  seed: number;
  variant: string | null;
  complication: string | null;
  statements: { t: number; text: string }[];
  messages: Message[];
};

export function buildTranscript(sim: Sim): Transcript {
  return {
    v: 1,
    seed: sim.case.seed,
    variant: sim.case.variantId ?? null,
    complication: sim.comp?.id ?? null,
    statements: sim.statements ?? [],
    messages: sim.messages,
  };
}

/** Runs with fewer student messages than this are tries, not practice — not saved. */
const MIN_MESSAGES = 3;

export function buildResult(content: Content, sim: Sim): NewResult | null {
  if (!sim.ended) return null;
  if (sim.messages.filter((m) => m.from === "user").length < MIN_MESSAGES) return null;
  const d = debrief(content, sim);
  const cut = (s: string) => s.slice(0, 300);
  return {
    scenario: `${sim.case.templateId}/${sim.case.variantId ?? ""}`.slice(0, 100),
    title: d.title.slice(0, 200),
    station: sim.case.station.slice(0, 50),
    score_done: d.score.done,
    score_total: d.score.total,
    critical_missed: d.score.criticalMissed,
    duration_sec: Math.round(sim.ended.t),
    details: {
      checklist: d.checklist.map((c) => ({ label: cut(c.label), critical: c.critical, done: c.doneAt !== null, late: c.late })),
      errors: d.errors.slice(0, 20).map((e) => cut(e.text)),
      warnings: d.warnings.slice(0, 20).map((w) => cut(w.text)),
      complication: d.complication ? { title: cut(d.complication.title), resolved: d.complication.resolvedAt !== null } : null,
    },
  };
}

/** Same score as the debrief: steps done, minus 10 points per error. */
export const percent = (r: Pick<ResultRow, "score_done" | "score_total"> & { details?: Partial<Pick<ResultDetails, "errors" | "checklist">> }) =>
  scorePct(r.details?.checklist ? stepCredit(r.details.checklist) : r.score_done, r.score_total, r.details?.errors?.length ?? 0);

export type WeakSpots = {
  runs: number;
  /** Checklist items missed, with how many runs they applied to. */
  missed: { label: string; critical: boolean; missed: number; of: number }[];
  late: { label: string; count: number }[];
  errors: { text: string; count: number }[];
  stations: { station: string; avg: number; runs: number }[];
  storylines: { title: string; avg: number; runs: number }[];
};

/** Summarises a student's results: what they miss, get wrong or do late most often, and where they score lowest. */
export function weakSpots(rows: ResultRow[], top = 8): WeakSpots {
  const items = new Map<string, { critical: boolean; missed: number; of: number; late: number }>();
  const errors = new Map<string, number>();
  const stations = new Map<string, number[]>();
  const storylines = new Map<string, number[]>();

  for (const r of rows) {
    for (const c of r.details?.checklist ?? []) {
      const it = items.get(c.label) ?? { critical: c.critical, missed: 0, of: 0, late: 0 };
      it.of++;
      if (!c.done) it.missed++;
      if (c.late) it.late++;
      it.critical ||= c.critical;
      items.set(c.label, it);
    }
    for (const e of new Set(r.details?.errors ?? [])) errors.set(e, (errors.get(e) ?? 0) + 1);
    stations.set(r.station, [...(stations.get(r.station) ?? []), percent(r)]);
    storylines.set(r.title, [...(storylines.get(r.title) ?? []), percent(r)]);
  }

  const avg = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
  const byRate = (a: { missed: number; of: number; critical: boolean }, b: typeof a) =>
    b.missed / b.of - a.missed / a.of || Number(b.critical) - Number(a.critical) || b.missed - a.missed;

  return {
    runs: rows.length,
    missed: [...items]
      .map(([label, it]) => ({ label, critical: it.critical, missed: it.missed, of: it.of }))
      .filter((x) => x.missed > 0)
      .sort(byRate)
      .slice(0, top),
    late: [...items]
      .filter(([, it]) => it.late > 0)
      .map(([label, it]) => ({ label, count: it.late }))
      .sort((a, b) => b.count - a.count)
      .slice(0, top),
    errors: [...errors]
      .map(([text, count]) => ({ text, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, top),
    stations: [...stations].map(([station, xs]) => ({ station, avg: avg(xs), runs: xs.length })).sort((a, b) => a.avg - b.avg),
    storylines: [...storylines]
      .map(([title, xs]) => ({ title, avg: avg(xs), runs: xs.length }))
      .sort((a, b) => a.avg - b.avg)
      .slice(0, top),
  };
}
