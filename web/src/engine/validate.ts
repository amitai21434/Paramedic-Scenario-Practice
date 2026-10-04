// Checks hand-written scenario content for mistakes the engine would only hit
// mid-scenario: unknown states, actions, drugs or variables, and states that
// break the physiology rules.

import { withVariant } from "./generate";
import { ACTIONS, DRUGS } from "./lexicon";
import { RHYTHMS } from "./physiology";
import type { CaseTemplate, Cond, Content, Rule, VitalKey } from "./types";

const ACTION_IDS = new Set(ACTIONS.map((a) => a.id));
const DRUG_IDS = new Set(DRUGS.map((d) => d.id));
const FLAGS = new Set([
  "cpr", "o2", "iv", "io", "monitor", "spo2probe", "capno", "cpap", "intubated", "sga", "bvm", "pacing",
  "sitting", "side", "transport", "lucas", "sedated", "cooling", "warming", "uterineMassage",
  "tourniquet", "pressure", "pelvicBinder", "chestSeal", "splint", "burnDress", "cSpine",
]);

export function validate(content: Content): string[] {
  const problems: string[] = [];
  for (const [id] of Object.entries(content.drugs)) if (!DRUG_IDS.has(id)) problems.push(`drugs.mjs: unknown drug "${id}"`);
  const comps = new Set(Object.keys(content.complications ?? {}));
  for (const base of content.cases) {
    const variants = base.variants?.length ? base.variants.map((v) => v.id) : [null];
    for (const v of variants) checkTemplate(withVariant(base, v), `${base.id}${v ? `/${v}` : ""}`, problems, comps);
  }
  // A complication is checked as a stand-alone template with no states of its own.
  for (const [id, d] of Object.entries(content.complications ?? {})) {
    const where = `complication ${id}`;
    const fake = { id, states: {}, initial: "", dispatch: ["-"], scene: ["-"], diagnoses: [{ label: "-", words: [] }], checklist: d.checklist } as unknown as CaseTemplate;
    const before = problems.length;
    checkTemplate({ ...fake, rules: [{ when: d.eligible }, { when: d.resolvedWhen }] }, where, problems, comps);
    // The fake template has no initial state; that one complaint isn't real.
    problems.splice(before, problems.length - before, ...problems.slice(before).filter((p) => !p.includes("initial state")));
    for (const f of d.clearFlags ?? []) if (!FLAGS.has(f)) problems.push(`${where}: unknown flag "${f}"`);
    const keys = [...Object.keys(d.vitals ?? {}), ...Object.keys(d.worsen?.vitals ?? {})] as VitalKey[];
    for (const k of keys) if (!["hr", "sbp", "dbp", "rr", "spo2", "etco2", "glucose", "temp", "gcs"].includes(k)) problems.push(`${where}: unknown vital "${k}"`);
  }
  return problems;
}

function checkTemplate(t: CaseTemplate, where: string, problems: string[], comps: Set<string>) {
  const p = (msg: string) => problems.push(`${where}: ${msg}`);
  const states = t.states ?? {};
  const vars = new Set(Object.keys(t.vars ?? {}));

  const num = (n: unknown, ctx: string) => {
    if (typeof n === "string" && !vars.has(n.replace(/^\$/, ""))) p(`${ctx}: unknown variable ${n}`);
  };
  const cond = (c: Cond, ctx: string): void => {
    if ("all" in c) return c.all.forEach((x) => cond(x, ctx));
    if ("any" in c) return c.any.forEach((x) => cond(x, ctx));
    if ("not" in c) return cond(c.not, ctx);
    if ("done" in c) {
      if (!ACTION_IDS.has(c.done)) p(`${ctx}: unknown action "${c.done}"`);
      num(c.min, ctx);
    } else if ("drug" in c) {
      if (!DRUG_IDS.has(c.drug)) p(`${ctx}: unknown drug "${c.drug}"`);
      num(c.min, ctx);
    } else if ("flag" in c) {
      if (!FLAGS.has(c.flag)) p(`${ctx}: unknown flag "${c.flag}"`);
    } else if ("flagFor" in c) {
      if (!FLAGS.has(c.flagFor)) p(`${ctx}: unknown flag "${c.flagFor}"`);
      num(c.sec, ctx);
    } else if ("inState" in c) num(c.inState, ctx);
    else if ("elapsed" in c) num(c.elapsed, ctx);
    else if ("var" in c) {
      if (!vars.has(c.var)) p(`${ctx}: unknown variable "${c.var}"`);
    } else if ("state" in c || "visited" in c) {
      const s = "state" in c ? c.state : c.visited;
      if (!states[s]) p(`${ctx}: unknown state "${s}"`);
    } else if ("comp" in c) {
      if (!comps.has(c.comp)) p(`${ctx}: unknown complication "${c.comp}"`);
    } else if (!("fact" in c || "vital" in c || "pulse" in c || "sex" in c)) p(`${ctx}: unrecognized condition ${JSON.stringify(c)}`);
  };
  const rule = (r: Rule, ctx: string) => {
    cond(r.when, ctx);
    if (r.to && !states[r.to]) p(`${ctx}: rule goes to unknown state "${r.to}"`);
  };

  if (!states[t.initial]) p(`initial state "${t.initial}" doesn't exist`);
  if (!t.dispatch?.length || !t.scene?.length) p("needs dispatch and scene text");
  if (!t.checklist?.length) p("empty checklist");
  if (!t.diagnoses?.length) p("no expected diagnosis (content/diagnoses.mjs)");

  for (const [id, s] of Object.entries(states)) {
    const ctx = `state ${id}`;
    if (s.extends && !states[s.extends]) p(`${ctx}: extends unknown state "${s.extends}"`);
    if (s.rhythm && !RHYTHMS[s.rhythm]) p(`${ctx}: unknown rhythm "${s.rhythm}"`);
    s.rules?.forEach((r, i) => rule(r, `${ctx} rule ${i}`));
    // A state with a pulse must say what its blood pressure is (itself or through extends).
    let full = s;
    for (let k = 0; full.extends && k < 5; k++) full = { ...states[full.extends], ...full, extends: states[full.extends]?.extends };
    const rhythm = full.rhythm ?? "sinus";
    const pulse = !RHYTHMS[rhythm]?.noPulseAlways && full.pulse !== false;
    if (pulse && !s.end && (full.sbp === undefined || full.hr === undefined)) p(`${ctx}: has a pulse but no hr/sbp`);
  }
  t.rules?.forEach((r, i) => rule(r, `global rule ${i}`));
  t.checklist?.forEach((c, i) => {
    cond(c.when, `checklist ${i} (${c.label})`);
    if (c.onlyIf) cond(c.onlyIf, `checklist ${i} onlyIf`);
  });
  if (Array.isArray(t.complications)) for (const c of t.complications) if (!comps.has(c)) p(`unknown complication "${c}"`);
  for (const [action, a] of Object.entries(t.actions ?? {})) {
    if (!ACTION_IDS.has(action)) p(`actions: unknown action "${action}"`);
    a.before?.forEach((b, i) => cond(b.when, `action ${action} before ${i}`));
  }
  for (const [drug, r] of Object.entries(t.drugs ?? {})) {
    if (!DRUG_IDS.has(drug)) p(`drugs: unknown drug "${drug}"`);
    r.contra?.forEach((c, i) => cond(c.when, `drug ${drug} contra ${i}`));
  }
}
