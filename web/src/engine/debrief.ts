// End-of-scenario summary: what the case was, which protocol steps were done
// (and when), mistakes recorded along the way, and the timeline.

import { clock, evalCond } from "./engine";
import { ACTIONS, DRUGS, ROUTE_LABELS } from "./lexicon";
import { unitLabel } from "./dose";
import type { Content, Sim } from "./types";

export type Debrief = {
  title: string;
  patient: string;
  outcome: string;
  checklist: { label: string; critical: boolean; doneAt: number | null; late: boolean }[];
  errors: { t: number; text: string }[];
  warnings: { t: number; text: string }[];
  noFlow: number;
  protocols: { id: string; title: string }[];
  timeline: { t: string; text: string }[];
  score: { done: number; total: number; criticalMissed: number };
};

const OUTCOMES: Record<NonNullable<Sim["ended"]>["how"], string> = {
  transport: "הגעתם לבית החולים.",
  end: "התרחיש הסתיים.",
  death: "[[המטופל|המטופלת]] לא [[שרד|שרדה]].",
  good: "[[המטופל|המטופלת]] [[התייצב|התייצבה]].",
  bad: "מצב [[המטופל|המטופלת]] הידרדר.",
};

export function debrief(content: Content, sim: Sim): Debrief {
  const c = sim.case;
  const g = (s: string) => s.replace(/\[\[([^|\]]*)\|([^\]]*)\]\]/g, (_, m, f) => (c.sex === "m" ? m : f));

  const checklist = c.template.checklist
    .map((item, i) => ({ item, doneAt: sim.checks[i] ?? null }))
    .filter(({ item }) => !item.onlyIf || evalCond(content, sim, item.onlyIf))
    .map(({ item, doneAt }) => ({
      label: item.label,
      critical: !!item.critical,
      doneAt,
      late: doneAt !== null && item.by !== undefined && doneAt > item.by,
    }));
  // Deduplicate repeated identical feedback (e.g. three wrong doses of the same kind).
  const uniq = (kind: "error" | "warn") =>
    sim.feedback.filter((f, i, all) => f.kind === kind && all.findIndex((o) => o.kind === kind && o.text === f.text) === i).map(({ t, text }) => ({ t, text }));

  const label = (id: string) => ACTIONS.find((a) => a.id === id)?.label ?? id;
  const timeline = sim.actions.map((a) => {
    if (a.drug) {
      const d = a.drug;
      const name = DRUGS.find((x) => x.id === d.drug)?.name ?? d.drug;
      return { t: clock(a.t), text: `${name} ${d.value ?? ""} ${unitLabel(d.unit)} ${d.route ? (ROUTE_LABELS[d.route] ?? d.route) : ""}`.trim() };
    }
    return { t: clock(a.t), text: `${label(a.action)}${a.joules ? ` ${a.joules}J` : ""}` };
  });

  return {
    title: c.title,
    patient: g(`[[גבר|אישה]] [[בן|בת]] ${c.age}, ${c.weight} ק"ג. רקע: ${c.history}. תרופות: ${c.meds}. רגישויות: ${c.allergies}.`),
    outcome: g(sim.ended ? OUTCOMES[sim.ended.how] : "התרחיש לא הסתיים."),
    checklist,
    errors: uniq("error"),
    warnings: uniq("warn"),
    noFlow: sim.noFlow,
    protocols: c.protocols.map((id) => ({ id, title: content.protocols[id] ?? id })),
    timeline,
    score: {
      done: checklist.filter((i) => i.doneAt !== null).length,
      total: checklist.length,
      criticalMissed: checklist.filter((i) => i.critical && i.doneAt === null).length,
    },
  };
}
