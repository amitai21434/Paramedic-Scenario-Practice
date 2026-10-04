// End-of-scenario summary: what the case was, which protocol steps were done
// (and when), mistakes recorded along the way, and the timeline.

import { clock, evalCond } from "./engine";
import { ACTIONS, DRUGS, RHYTHM_NAMES, ROUTE_LABELS } from "./lexicon";
import { mentions } from "./parse";
import { unitLabel } from "./dose";
import { ageText } from "./generate";
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
  /** Informational only — never part of the score. */
  diagnosis: {
    items: { label: string; statedAt: number | null }[];
    rhythms: { label: string; statedAt: number | null }[];
    unmatched: { t: number; text: string }[];
  };
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
      label: g(item.label),
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

  const statements = sim.statements ?? [];
  const firstMatch = (words: string[], after = 0) =>
    statements.find((s) => s.t >= after && words.some((w) => mentions(s.text, w)))?.t ?? null;

  const items = (c.template.diagnoses ?? []).map((d) => ({ label: d.label, statedAt: firstMatch(d.words) }));

  // Every rhythm the student was shown (first time), to be read after seeing it.
  const shown = new Map<string, number>();
  for (const m of sim.messages) {
    if (!("ecg" in m) || m.ecg.mode === "cpr") continue;
    const key = m.ecg.pulseless ? "pea" : m.ecg.rhythm;
    if (!shown.has(key)) shown.set(key, m.t);
  }
  // A rhythm that's already one of the expected diagnoses (VF, SVT, complete block…) is listed once.
  const dxWords = new Set((c.template.diagnoses ?? []).flatMap((x) => x.words));
  for (const key of [...shown.keys()]) {
    if ((RHYTHM_NAMES[key]?.words ?? []).some((w) => dxWords.has(w))) shown.delete(key);
  }
  const rhythms = [...shown].map(([key, t]) => ({ label: RHYTHM_NAMES[key]?.label ?? key, statedAt: firstMatch(RHYTHM_NAMES[key]?.words ?? [], t) }));

  const allWords = [...(c.template.diagnoses ?? []).flatMap((d) => d.words), ...[...shown.keys()].flatMap((k) => RHYTHM_NAMES[k]?.words ?? [])];
  const unmatched = statements.filter((s) => !allWords.some((w) => mentions(s.text, w)));

  return {
    title: c.title,
    diagnosis: { items, rhythms, unmatched },
    patient: g(
      `${c.age < 1 ? "[[תינוק|תינוקת]]" : c.age < 16 ? "[[ילד|ילדה]]" : "[[גבר|אישה]]"} [[בן|בת]] ${ageText(c.age)}, ${c.weight} ק"ג. ` +
        `רקע: ${c.history}. תרופות: ${c.meds}. רגישויות: ${c.allergies}.`,
    ),
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
