// The scenario engine: applies what the student did, advances the simulated
// clock, fires the template's rules (deterioration, response to treatment) and
// records feedback for the debrief. Pure functions over a JSON Sim.

import { convert, splitUnit, unitLabel } from "./dose";
import { generate, resolve, rng, roll } from "./generate";
import { ACTIONS, DRUGS, ROUTE_LABELS } from "./lexicon";
import { parse, type ParsedItem } from "./parse";
import { consciousnessText, current, effectiveVitals, finding, hasPulse, isShockable, minSbp, RHYTHMS, snapshot, stateDef } from "./physiology";
import type {
  AnswerKey,
  Cond,
  Content,
  DrugGiven,
  DrugRule,
  EcgSnapshot,
  FindingKey,
  Num,
  Rule,
  Sim,
  Text,
  VitalKey,
  Vitals,
} from "./types";

const MAX_SECONDS = 45 * 60;
const NO_FLOW_LIMIT = 10 * 60;
const SEDATIVES = ["midazolam", "ketamine", "etomidate", "fentanyl"];
const VITAL_KEYS: VitalKey[] = ["hr", "sbp", "dbp", "rr", "spo2", "etco2", "glucose", "temp", "gcs"];
const DEFAULT_VITALS: Vitals = { hr: 80, sbp: 125, dbp: 80, rr: 16, spo2: 97, etco2: 38, glucose: 110, temp: 36.8, gcs: 15 };

const actionDef = (id: string) => ACTIONS.find((a) => a.id === id)!;
const drugDef = (id: string) => DRUGS.find((d) => d.id === id)!;

export function clock(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Starting a scenario
// ---------------------------------------------------------------------------

export function pickTemplate(content: Content, station: string | null, recent: string[], r = Math.random): string {
  const pool = content.cases.filter((c) => !station || c.station === station);
  if (!pool.length) throw new Error("No scenarios for this station");
  const fresh = pool.filter((c) => !recent.includes(c.id));
  const from = fresh.length ? fresh : pool;
  return from[Math.floor(r() * from.length)].id;
}

/** `complications`: ids that may appear this run (from rollComplication); none by default. */
export function startSim(content: Content, templateId: string, seed: number, variantId?: string, complications?: string[] | null): Sim {
  const template = content.cases.find((c) => c.id === templateId);
  if (!template) throw new Error(`Unknown scenario ${templateId}`);
  const c = generate(template, seed, variantId);
  const ids = (complications ?? []).filter((id) => content.complications?.[id]);
  if (ids.length) {
    const at = rng((seed ^ 0x2545f491) >>> 0).int(90, 420);
    c.complication = { ids, at, until: at + 900 };
    // Each complication's debrief items count only if it actually happened.
    const extra = ids.flatMap((id) =>
      content.complications![id].checklist.map((item) => ({
        ...item,
        onlyIf: item.onlyIf ? { all: [{ comp: id }, item.onlyIf] } : { comp: id },
      })),
    );
    const drugs = { ...c.template.drugs };
    for (const id of ids)
      for (const [d, rule] of Object.entries(content.complications![id].drugs ?? {})) drugs[d] = { ...rule, ...drugs[d] };
    c.template = { ...c.template, checklist: [...c.template.checklist, ...extra], drugs };
  }
  const sim: Sim = {
    case: c,
    t: 0,
    state: c.template.initial,
    stateSince: 0,
    vitals: { ...DEFAULT_VITALS },
    flags: [],
    flagSince: {},
    actions: [],
    fired: [],
    feedback: [],
    measured: {},
    noFlow: 0,
    pending: null,
    messages: [],
    visited: [],
    statements: [],
    checks: {},
    ended: null,
    transportAt: null,
  };
  const out = new Output();
  out.text(`📟 ${c.dispatch}`);
  out.text(c.scene);
  enter(sim, c.template.initial, out);
  out.flush(sim);
  return sim;
}

// ---------------------------------------------------------------------------
// One student message
// ---------------------------------------------------------------------------

/** Collects examiner output for one turn; consecutive text lines become one message. */
class Output {
  parts: ({ text: string } | { ecg: EcgSnapshot; caption: string })[] = [];
  text(s: string) {
    if (s.trim()) this.parts.push({ text: s });
  }
  ecg(ecg: EcgSnapshot, caption: string) {
    this.parts.push({ ecg, caption });
  }
  /** `t`: the turn's start time, so replies line up with when the action was done. */
  flush(sim: Sim, t = sim.t) {
    let buf: string[] = [];
    const push = () => {
      if (buf.length) sim.messages.push({ from: "examiner", text: buf.join("\n"), t });
      buf = [];
    };
    for (const p of this.parts) {
      if ("text" in p) buf.push(p.text);
      else {
        push();
        sim.messages.push({ from: "examiner", t, ecg: p.ecg, caption: p.caption });
      }
    }
    push();
    this.parts = [];
  }
}

export type StepResult = { sim: Sim; understood: boolean };

export function step(content: Content, prev: Sim, text: string): StepResult {
  const sim: Sim = structuredClone(prev);
  sim.messages.push({ from: "user", text });
  if (sim.ended) return { sim, understood: true };

  const out = new Output();
  const t0 = sim.t;
  const parsed = parse(text);
  let items: ParsedItem[] = parsed.items;

  // Diagnoses are recorded without comment — the examiner doesn't say if they're right.
  sim.statements ??= [];
  for (const s of parsed.statements) sim.statements.push({ t: sim.t, text: s });
  if (parsed.statements.length) out.text("📝 נרשם.");
  if (parsed.statements.length && !items.length && !(sim.pending && parsed.bare)) {
    out.flush(sim, t0);
    return { sim, understood: true };
  }

  // "באיזה מינון?" → "300 מג"
  if (!items.length && sim.pending && parsed.bare) {
    const p = sim.pending;
    items =
      p.need === "dose" && p.drug
        ? [{ kind: "drug", drug: p.drug, value: parsed.bare.value, unit: parsed.bare.unit, route: null, phrase: "" }]
        : [{ kind: "action", id: p.action, joules: parsed.bare.value, phrase: "" }];
  }
  sim.pending = null;

  if (!items.length) {
    out.text(
      parsed.negated.length
        ? "הבנתי מה לא לעשות 🙂 — מה כן?"
        : "לא הבנתי את הפעולה. נסי לנסח אחרת, למשל פעולה אחת בכל משפט.",
    );
    out.flush(sim);
    return { sim, understood: parsed.negated.length > 0 };
  }

  // Expand compound actions ("מדדים" → pulse, BP, SpO2, RR).
  const expanded = items.flatMap((it) =>
    it.kind === "action" && actionDef(it.id).expands
      ? actionDef(it.id).expands!.map((id) => ({ kind: "action" as const, id, phrase: it.phrase }))
      : [it],
  );

  let longest = 0;
  for (const item of expanded) {
    const sec = item.kind === "drug" ? 30 : actionDef(item.id).sec;
    perform(content, sim, item, out);
    longest = Math.max(longest, sec);
    applyRules(content, sim, out);
    updateChecks(content, sim);
    if (sim.ended) break;
  }
  // A team works in parallel: a turn takes about as long as its longest task.
  if (!sim.ended) advance(content, sim, longest + 5 * (expanded.length - 1), out);
  out.flush(sim, t0);
  return { sim, understood: true };
}

// ---------------------------------------------------------------------------
// Time and state
// ---------------------------------------------------------------------------

function advance(content: Content, sim: Sim, seconds: number, out: Output) {
  let left = seconds;
  while (left > 0 && !sim.ended) {
    const dt = Math.min(30, left);
    left -= dt;
    sim.t += dt;
    if (!hasPulse(current(sim)) && !sim.flags.includes("cpr")) sim.noFlow += dt;
    applyRules(content, sim, out);
    updateChecks(content, sim);
    if (sim.noFlow >= NO_FLOW_LIMIT) {
      out.text("⛔ עברו 10 דקות ללא עיסויים. התרחיש הסתיים.");
      end(sim, "death");
    } else if (sim.t >= MAX_SECONDS) {
      out.text("⏱️ עברו 45 דקות. התרחיש הסתיים.");
      end(sim, "end");
    }
  }
}

function enter(sim: Sim, id: string, out: Output) {
  const def = stateDef(sim.case, id);
  sim.state = id;
  sim.stateSince = sim.t;
  if (!sim.visited.includes(id)) sim.visited.push(id);
  sim.fired = sim.fired.filter((k) => k.startsWith("g:"));
  const r = rng(sim.case.seed + Math.round(sim.t) * 7919 + id.length * 104729);
  for (const k of VITAL_KEYS) {
    const v = roll(r, def[k], k === "temp" ? 1 : 0);
    if (v !== null) sim.vitals[k] = v;
  }
  if (def.say) out.text(resolve(def.say, sim.case));
  if (def.end) end(sim, def.end);
}

function end(sim: Sim, how: NonNullable<Sim["ended"]>["how"]) {
  if (!sim.ended) sim.ended = { how, t: sim.t };
}

function applyRules(content: Content, sim: Sim, out: Output) {
  applyStateRules(content, sim, out);
  complicationTick(content, sim, out);
}

/** Starts, resolves or worsens this run's complication (see ComplicationDef). */
function complicationTick(content: Content, sim: Sim, out: Output) {
  const plan = sim.case.complication;
  if (!plan || sim.ended) return;
  const say = (t: Text | undefined) => t && out.text(resolve(t, sim.case));
  if (!sim.comp) {
    if (sim.t < plan.at || sim.t > plan.until) return;
    for (const id of plan.ids) {
      const def = content.complications?.[id];
      if (!def || !evalCond(content, sim, def.eligible)) continue;
      for (const f of def.clearFlags ?? []) setFlag(sim, f, false);
      sim.comp = { id, t: sim.t, n: sim.actions.length, resolvedAt: null, worse: false, vitals: { ...def.vitals }, cap: { ...def.cap }, findings: resolveFindings(sim, def.findings) };
      say(def.say);
      return;
    }
    return;
  }
  const comp = sim.comp;
  const def = content.complications?.[comp.id];
  if (!def || comp.resolvedAt !== null) return;
  if (evalCond(content, sim, def.resolvedWhen)) {
    comp.resolvedAt = sim.t;
    say(def.resolvedSay);
  } else if (def.worsen && !comp.worse && sim.t - comp.t >= def.worsen.after) {
    comp.worse = true;
    for (const [k, d] of Object.entries(def.worsen.vitals ?? {}) as [VitalKey, number][]) {
      comp.vitals[k] = (comp.vitals[k] ?? 0) + d;
      if (comp.cap?.[k] !== undefined) comp.cap[k] += d;
    }
    Object.assign(comp.findings, resolveFindings(sim, def.worsen.findings));
    say(def.worsen.say);
  }
}

function resolveFindings(sim: Sim, f: Partial<Record<FindingKey, Text>> | undefined): Partial<Record<FindingKey, string>> {
  return Object.fromEntries(Object.entries(f ?? {}).map(([k, v]) => [k, resolve(v as Text, sim.case)]));
}

/**
 * Rolls whether this run gets a complication (about one in three) and which
 * ones may appear, in random order. Deterministic for a seed.
 */
export function rollComplication(content: Content, templateId: string, seed: number, variantId?: string, chance = 0.35): string[] | null {
  const template = content.cases.find((c) => c.id === templateId);
  const t = template ? generate(template, seed, variantId).template : undefined;
  const allowed = t?.complications;
  if (allowed === false) return null;
  const all = content.complications ?? {};
  const ids = Object.keys(all).filter(
    (id) => (allowed ? allowed.includes(id) : !all[id].optIn) || t?.extraComplications?.includes(id),
  );
  const r = rng((seed ^ 0x5bd1e995) >>> 0);
  if (!ids.length || r.next() >= chance) return null;
  for (let i = ids.length - 1; i > 0; i--) {
    const j = r.int(0, i);
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids;
}

function applyStateRules(content: Content, sim: Sim, out: Output) {
  for (let hop = 0; hop < 6 && !sim.ended; hop++) {
    const stateRules = (current(sim).rules ?? []).map((rule, i) => ({ rule, key: `s:${i}` }));
    const globalRules = (sim.case.template.rules ?? []).map((rule, i) => ({ rule, key: `g:${i}` }));
    let moved = false;
    for (const { rule, key } of [...stateRules, ...globalRules]) {
      if (!rule.repeat && sim.fired.includes(key)) continue;
      if (!evalCond(content, sim, rule.when)) continue;
      if (!rule.repeat) sim.fired.push(key);
      fire(sim, rule, out);
      if (rule.to && rule.to !== sim.state) {
        enter(sim, rule.to, out);
        moved = true;
        break;
      }
    }
    if (!moved) return;
  }
}

function fire(sim: Sim, rule: Rule, out: Output) {
  for (const [k, d] of Object.entries(rule.vitals ?? {}) as [VitalKey, number][]) {
    const v = sim.vitals[k];
    if (v !== null) sim.vitals[k] = Math.round((v + d) * 10) / 10;
  }
  if (rule.say) out.text(resolve(rule.say, sim.case));
}

function updateChecks(content: Content, sim: Sim) {
  sim.case.template.checklist.forEach((item, i) => {
    if (sim.checks[i] === undefined && evalCond(content, sim, item.when)) sim.checks[i] = sim.t;
  });
}

// ---------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------

function num(sim: Sim, n: Num | undefined, fallback: number): number {
  if (n === undefined) return fallback;
  if (typeof n === "number") return n;
  const v = sim.case.vars[n.replace(/^\$/, "")];
  if (v === undefined) throw new Error(`Unknown variable ${n}`);
  return v;
}

export function evalCond(content: Content, sim: Sim, c: Cond): boolean {
  if ("all" in c) return c.all.every((x) => evalCond(content, sim, x));
  if ("any" in c) return c.any.some((x) => evalCond(content, sim, x));
  if ("not" in c) return !evalCond(content, sim, c.not);
  if ("age" in c) return (c.age.lt === undefined || sim.case.age < c.age.lt) && (c.age.gt === undefined || sim.case.age > c.age.gt);
  if ("comp" in c) return sim.comp?.id === c.comp && (c.resolved === undefined || (sim.comp.resolvedAt !== null) === c.resolved);
  // Actions performed after the complication started (by position, so a same-second action before it doesn't count).
  const afterComp = (i: number) => sim.comp != null && i >= sim.comp.n;
  if ("done" in c) {
    const n = sim.actions.filter(
      (a, i) =>
        a.action === c.done &&
        (!c.sinceState || a.t >= sim.stateSince) &&
        (!c.sinceComp || afterComp(i)) &&
        (!c.joules || (a.joules !== undefined && a.joules >= c.joules[0] && a.joules <= c.joules[1])) &&
        (!c.joulesPerKg ||
          (a.joules !== undefined &&
            a.joules / sim.case.weight >= c.joulesPerKg[0] * 0.9 &&
            a.joules / sim.case.weight <= c.joulesPerKg[1] * 1.1)),
    ).length;
    return n >= num(sim, c.min, 1);
  }
  if ("drug" in c) {
    const given = sim.actions.filter((a, i) => a.drug?.drug === c.drug && (!c.sinceState || a.t >= sim.stateSince) && (!c.sinceComp || afterComp(i)));
    if (c.min === undefined) return given.length > 0;
    return totalDose(content, sim, c.drug, given.map((a) => a.drug!)) >= num(sim, c.min, 0);
  }
  if ("flag" in c) return sim.flags.includes(c.flag);
  if ("flagFor" in c) return sim.flags.includes(c.flagFor) && sim.t - (sim.flagSince[c.flagFor] ?? sim.t) >= num(sim, c.sec, 0);
  if ("inState" in c) return sim.t - sim.stateSince >= num(sim, c.inState, 0);
  if ("elapsed" in c) return sim.t >= num(sim, c.elapsed, 0);
  if ("fact" in c) return sim.case.facts.includes(c.fact);
  if ("pulse" in c) return hasPulse(current(sim)) === c.pulse;
  if ("var" in c) {
    const v = sim.case.vars[c.var];
    return v !== undefined && (c.eq === undefined || v === c.eq) && (c.lt === undefined || v < c.lt) && (c.gt === undefined || v > c.gt);
  }
  if ("sex" in c) return sim.case.sex === c.sex;
  if ("state" in c) return sim.state === c.state;
  if ("visited" in c) return sim.visited.includes(c.visited);
  if ("vital" in c) {
    const v = effectiveVitals(sim)[c.vital];
    if (v === null) return false;
    return (c.lt === undefined || v < c.lt) && (c.gt === undefined || v > c.gt);
  }
  return false;
}

// ---------------------------------------------------------------------------
// Drugs
// ---------------------------------------------------------------------------

export function drugRule(content: Content, sim: Sim, drug: string): DrugRule | null {
  const general = content.drugs[drug];
  const own = sim.case.template.drugs?.[drug];
  if (!general && !own) return null;
  return {
    ...general,
    ...own,
    contra: [...(general?.contra ?? []), ...(own?.contra ?? [])],
    before: [...(general?.before ?? []), ...(own?.before ?? [])],
  };
}

/** Total given, in the case rule's unit (so conditions like { drug: "atropine", min: 3 } read naturally). */
function totalDose(content: Content, sim: Sim, drug: string, given: DrugGiven[]): number {
  const rule = drugRule(content, sim, drug);
  const unit = rule?.unit || drugDef(drug).unit;
  return given.reduce((sum, g) => sum + inMainUnit(rule, unit, g, sim.case.weight), 0);
}

/** A given dose expressed in the rule's main unit (0 when it can't be compared). */
function inMainUnit(rule: DrugRule | null, unit: string, g: DrugGiven, weight: number): number {
  if (g.value === null) return 0;
  const direct = convert(g.value, g.unit ?? unit, unit, weight);
  if (direct !== null) return direct;
  for (const alt of rule?.alts ?? []) {
    const v = alt.equals !== undefined ? convert(g.value, g.unit ?? unit, alt.unit, weight) : null;
    if (v !== null) return v * alt.equals!;
  }
  return 0;
}

function feedback(sim: Sim, kind: "error" | "warn", text: string) {
  sim.feedback.push({ t: sim.t, kind, text });
}

function giveDrug(content: Content, sim: Sim, item: Extract<ParsedItem, { kind: "drug" }>, out: Output) {
  const def = drugDef(item.drug);
  const rule = drugRule(content, sim, item.drug);
  // A bare number means the drug's usual unit: "קטמין 50" is 50 mg, but "דופמין 10" is 10 mcg/kg/min.
  const usual = rule?.unit ?? def.unit;
  const unit = item.unit ?? (usual.includes("/min") ? usual : usual.replace("/kg", ""));

  if (item.value === null) {
    sim.pending = { action: "drug", drug: item.drug, need: "dose" };
    out.text(`${def.name} — באיזה מינון?`);
    return;
  }

  const access = sim.flags.includes("iv") || sim.flags.includes("io");
  let route = item.route;
  if (!route && rule?.routes?.length) route = rule.routes.find((r) => (r === "iv" || r === "io" ? access : true)) ?? rule.routes[0];
  if (!route && item.drug === "saline") route = "iv";
  if ((route === "iv" || route === "io" || route === "drip") && !access) {
    out.text(`אין גישה ורידית או תוך־גרמית — ${def.name} לא ניתן.`);
    return;
  }

  const given: DrugGiven = { drug: item.drug, value: item.value, unit, route, t: sim.t };
  const priorSame = sim.actions.filter((a) => a.drug?.drug === item.drug).map((a) => a.drug!);
  sim.actions.push({ action: `drug:${item.drug}`, t: sim.t, state: sim.state, drug: given });
  if (SEDATIVES.includes(item.drug)) setFlag(sim, "sedated");

  const shown = `${def.name} ${item.value} ${unitLabel(unit)}${route ? ` ${ROUTE_LABELS[route] ?? route}` : ""}`;
  out.text(`✔ ${shown} — ניתן.`);
  checkDrug(content, sim, rule, given, priorSame, shown);
}

function checkDrug(content: Content, sim: Sim, rule: DrugRule | null, g: DrugGiven, prior: DrugGiven[], shown: string) {
  const name = drugDef(g.drug).name;
  if (sim.case.allergyDrug === g.drug) feedback(sim, "error", `${shown}: ${sim.case.sex === "m" ? "המטופל אלרגי" : "המטופלת אלרגית"} ל${name} (נאמר בתשאול רגישויות).`);
  if (!rule || !rule.status) {
    feedback(sim, "warn", `${shown}: ${name} אינו חלק מהטיפול לפי הפרוטוקול בתרחיש הזה.`);
  } else if (rule.status === "wrong") {
    feedback(sim, "error", `${shown}: ${rule.why ?? "לא היה צריך לתת בתרחיש הזה."}`);
  }
  for (const c of rule?.contra ?? []) {
    if (evalCond(content, sim, c.when)) feedback(sim, "error", `${shown}: התווית נגד — ${c.why}`);
  }
  for (const b of rule?.before ?? []) {
    if (!evalCond(content, sim, b.when)) feedback(sim, "error", `${shown}: ${b.why}`);
  }
  // Someone could have been asked (the patient, or a bystander for an unresponsive patient) —
  // but not in cardiac arrest, where drugs come first.
  const askable = hasPulse(current(sim)) && (canTalk(sim) || sim.case.bystander !== null);
  if (g.drug !== "saline" && askable && !evalCond(content, sim, { done: "askAllergies" })) {
    feedback(sim, "warn", "ניתנה תרופה לפני ששאלת על רגישויות.");
  }
  if (rule?.dose && rule.unit && g.value !== null && g.unit) {
    // Check against the first accepted form whose unit is comparable (dose vs. rate).
    const forms: { unit: string; dose: [number, number]; routes?: string[]; cap?: number }[] = [
      { unit: rule.unit, dose: rule.dose, routes: rule.routes, cap: rule.cap },
      ...(rule.alts ?? []),
    ];
    const describe = (f: (typeof forms)[number]) =>
      `${f.dose[0] === f.dose[1] ? f.dose[0] : `${f.dose[0]}–${f.dose[1]}`} ${unitLabel(f.unit)}` +
      (f.cap !== undefined ? ` (עד ${f.cap} ${unitLabel(splitUnit(f.unit).base)})` : "") +
      (forms.length > 1 && f.routes?.length ? ` (${f.routes.map((r) => ROUTE_LABELS[r] ?? r).join("/")})` : "");
    // Prefer the form for this route: adrenaline 0.5 mg is right IM but wrong IV (10–20 mcg).
    const comparable = forms.filter((f) => convert(g.value!, g.unit!, f.unit, sim.case.weight) !== null);
    const forRoute = forms.filter((f) => g.route && f.routes?.includes(g.route));
    const form = forRoute.length ? forRoute.find((f) => comparable.includes(f)) : comparable[0];
    if (!form) {
      feedback(sim, "warn", `${shown}: לא ניתן לבדוק את המינון ביחידות שנכתבו (הפרוטוקול: ${forms.map(describe).join(" או ")}).`);
    } else {
      let v = convert(g.value, g.unit, form.unit, sim.case.weight)!;
      let [lo, hi] = form.dose;
      if (form.cap !== undefined && splitUnit(form.unit).perKg) {
        // Compare whole doses: a heavy child gets the capped dose, not the per-kg dose.
        const w = sim.case.weight;
        v *= w;
        [lo, hi] = [Math.min(lo * w, form.cap), Math.min(hi * w, form.cap)];
      }
      if (v < lo * 0.95 || v > hi * 1.05) {
        feedback(sim, "error", `${shown}: מינון שגוי. לפי הפרוטוקול ${forms.map(describe).join(" או ")}${forms.some((f) => splitUnit(f.unit).perKg) ? ` (משקל ${sim.case.weight} ק"ג)` : ""}.`);
      }
    }
    if (rule.max != null && !splitUnit(rule.unit).perMin) {
      const total = [...prior, g].reduce((s, x) => s + inMainUnit(rule, rule.unit!, x, sim.case.weight), 0);
      if (total > rule.max * 1.05) feedback(sim, "error", `${shown}: חריגה מהמינון המקסימלי (${rule.max} ${unitLabel(rule.unit)}).`);
    }
  }
  const routes = [...(rule?.routes ?? []), ...(rule?.alts ?? []).flatMap((a) => a.routes ?? [])];
  if (routes.length && g.route && !routes.includes(g.route)) {
    feedback(sim, "error", `${shown}: דרך מתן שגויה (לפי הפרוטוקול: ${[...new Set(routes)].map((r) => ROUTE_LABELS[r] ?? r).join(" / ")}).`);
  }
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

const FINDING_ACTIONS: Partial<Record<string, [FindingKey, string]>> = {
  general: ["general", "התרשמות כללית"],
  airway: ["airway", "נתיב אוויר"],
  breathing: ["breathing", "נשימה"],
  lungs: ["lungs", "האזנה לריאות"],
  skin: ["skin", "עור"],
  capRefill: ["capRefill", "מילוי קפילרי"],
  jvd: ["jvd", "ורידי צוואר"],
  edema: ["edema", "גפיים תחתונות"],
  chest: ["chest", "בית החזה"],
  heart: ["heart", "קולות לב"],
  abdomen: ["abdomen", "בטן"],
  pupils: ["pupils", "אישונים"],
  neuro: ["neuro", "בדיקה נוירולוגית"],
  vaginal: ["vaginal", "דימום וגינלי"],
  mouth: ["mouth", "חלל הפה"],
  newborn: ["newborn", "היילוד"],
  head: ["head", "ראש ופנים"],
  neck: ["neck", "צוואר"],
  pelvis: ["pelvis", "אגן"],
  limbs: ["limbs", "גפיים"],
  back: ["back", "גב"],
  burns: ["burns", "כוויות"],
};

const QUESTIONS: Partial<Record<string, AnswerKey>> = {
  askComplaint: "complaint",
  askOnset: "onset",
  askPain: "pain",
  askHistory: "history",
  askMeds: "meds",
  askAllergies: "allergies",
  askLastMeal: "lastMeal",
  askEvents: "events",
  askPde5: "pde5",
  askPrevious: "previous",
  askSymptoms: "symptoms",
};
/** What a bystander can answer for an unresponsive patient. */
const BYSTANDER_KEYS: AnswerKey[] = ["complaint", "onset", "history", "meds", "allergies", "events", "previous", "pde5", "lastMeal"];

function answer(sim: Sim, key: AnswerKey): string {
  const c = sim.case;
  const t = c.template;
  const own = current(sim).answers?.[key] ?? t.answers[key];
  if (own !== undefined) return resolve(own, c);
  switch (key) {
    case "history":
      return c.history;
    case "meds":
      return c.meds;
    case "allergies":
      return c.allergies;
    case "pde5":
      return c.facts.includes("pde5") ? "כן, לקחתי ויאגרה אתמול בלילה." : "לא.";
    case "lastMeal":
      return "אכלתי ארוחת בוקר לפני כמה שעות.";
    case "previous":
      return "לא, זו הפעם הראשונה.";
    case "symptoms":
      return "לא, רק מה שאמרתי.";
    case "events":
      return "לא עשיתי שום דבר מיוחד.";
    default:
      return "לא יודע[[|ת]].";
  }
}

const canTalk = (sim: Sim) => {
  const { vitals, pulse } = snapshot(sim);
  return pulse && (vitals.gcs ?? 15) >= 13 && !sim.flags.includes("intubated");
};

export function ecgSnapshot(sim: Sim, mode: EcgSnapshot["mode"]): EcgSnapshot {
  const def = current(sim);
  const rhythm = def.rhythm ?? "sinus";
  let seed = sim.case.seed;
  for (const ch of sim.state) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  return {
    rhythm,
    hr: effectiveVitals(sim).hr ?? 0,
    wide: def.wideQrs ?? RHYTHMS[rhythm].wide,
    st: def.st ?? {},
    seed,
    pulseless: !hasPulse(def) && !RHYTHMS[rhythm].noPulseAlways,
    peakedT: def.peakedT,
    mode,
  };
}

function setFlag(sim: Sim, flag: string, on = true) {
  if (on && !sim.flags.includes(flag)) sim.flagSince[flag] = sim.t;
  if (!on) delete sim.flagSince[flag];
  sim.flags = on ? [...new Set([...sim.flags, flag])] : sim.flags.filter((f) => f !== flag);
}

const recentlySedated = (sim: Sim) =>
  sim.actions.some((a) => a.drug && SEDATIVES.includes(a.drug.drug) && sim.t - a.t <= 15 * 60);

function perform(content: Content, sim: Sim, item: ParsedItem, out: Output) {
  if (item.kind === "drug") return giveDrug(content, sim, item, out);

  const id = item.id;
  const c = sim.case;
  const { def, vitals: v, pulse } = snapshot(sim);
  const flags = new Set(sim.flags);
  const record = (extra: Partial<Sim["actions"][number]> = {}) =>
    sim.actions.push({ action: id, t: sim.t, state: sim.state, ...extra });
  const say = (s: string) => out.text(resolve(s, c));
  const measure = (k: VitalKey) => (sim.measured[k] = { value: v[k], t: sim.t });

  const actionRule = sim.case.template.actions?.[id];
  for (const b of actionRule?.before ?? []) {
    if (!evalCond(content, sim, b.when)) feedback(sim, "error", `${actionDef(id).label}: ${b.why}`);
  }
  if (actionRule?.wrong) feedback(sim, "error", `${actionDef(id).label}: ${actionRule.wrong}`);

  const f = FINDING_ACTIONS[id];
  if (f) {
    record();
    return say(`${f[1]}: ${finding(sim, f[0])}`);
  }
  const q = QUESTIONS[id];
  if (q) {
    record();
    // A confused patient talks, but the history comes from whoever is with them.
    if (def.confused && c.bystander && BYSTANDER_KEYS.includes(q)) return say(`${c.bystander}: "${answer(sim, q)}"`);
    if (canTalk(sim)) return say(`[[המטופל|המטופלת]]: "${answer(sim, q)}"`);
    if (c.bystander && BYSTANDER_KEYS.includes(q)) return say(`${c.bystander}: "${answer(sim, q)}"`);
    return say(pulse && (v.gcs ?? 15) >= 9 ? "[[המטופל|המטופלת]] [[מבולבל|מבולבלת]] ולא עונה לעניין." : "[[המטופל|המטופלת]] [[אינו מגיב|אינה מגיבה]] — אין מי שיענה.");
  }

  switch (id) {
    case "scene":
      record();
      return say("הזירה בטוחה. הצוות ממוגן.");
    case "consciousness":
      record();
      return say(`מצב הכרה: ${pulse ? consciousnessText(v.gcs ?? 15) : "[[אינו מגיב|אינה מגיבה]] (U)"}`);
    case "gcs":
      record();
      measure("gcs");
      return say(`GCS: ${v.gcs}`);
    case "pulse": {
      record();
      measure("hr");
      if (!pulse) return say("דופק: אין דופק מרכזי.");
      if (flags.has("cpr")) {
        // Pulse is back: the team stops compressing.
        setFlag(sim, "cpr", false);
        setFlag(sim, "lucas", false);
        say("העיסויים הופסקו לבדיקת דופק.");
      }
      const regular = RHYTHMS[def.rhythm ?? "sinus"].regular ? "סדיר" : "לא סדיר";
      const low = minSbp(c.age);
      if (v.sbp !== null && v.sbp < low - 20) return say(`דופק: פריפרי לא נמוש. מרכזי ${v.hr}, ${regular}, חלש.`);
      return say(`דופק: ${v.hr}, ${regular}${v.sbp !== null && v.sbp < low ? ", חלש" : ""}.`);
    }
    case "bp":
      record();
      measure("sbp");
      measure("dbp");
      if (!pulse) return say("לחץ דם: לא ניתן למדידה.");
      return say(`לחץ דם: ${v.sbp}/${v.dbp}`);
    case "spo2":
      record();
      setFlag(sim, "spo2probe");
      measure("spo2");
      return say(pulse ? `סטורציה: ${v.spo2}%${flags.has("o2") ? " (בחמצן)" : ""}` : "סטורציה: אין גל — אין קריאה.");
    case "rr":
      record();
      measure("rr");
      return say(pulse || v.rr ? `קצב נשימה: ${v.rr} לדקה` : "קצב נשימה: [[אינו נושם|אינה נושמת]].");
    case "glucose":
      record();
      measure("glucose");
      return say(`סוכר: ${v.glucose} mg/dL`);
    case "temp":
      record();
      measure("temp");
      return say(`חום: ${v.temp}°C`);
    case "etco2":
      record();
      setFlag(sim, "capno");
      measure("etco2");
      return say(`ETCO2: ${v.etco2} mmHg`);
    case "monitor":
      record();
      setFlag(sim, "monitor");
      say("המוניטור מחובר.");
      return out.ecg(ecgSnapshot(sim, "strip"), "מוניטור — II");
    case "rhythmCheck":
      if (!flags.has("monitor")) return say("אין מוניטור מחובר.");
      record();
      return out.ecg(ecgSnapshot(sim, "strip"), "בדיקת קצב — II");
    case "ecg12":
      record();
      if (!pulse) {
        feedback(sim, "warn", "אק\"ג 12 ערוצים בזמן דום לב מעכב את הטיפול.");
        return say("לא ניתן לבצע אק\"ג 12 ערוצים בזמן דום לב.");
      }
      return out.ecg(ecgSnapshot(sim, "12"), "אק\"ג 12 ערוצים");
    case "ecgRight":
      record();
      if (!pulse) return say("לא ניתן לבצע בזמן דום לב.");
      return out.ecg(ecgSnapshot(sim, "right"), "ערוצים ימניים ואחוריים");
    case "o2":
      record();
      setFlag(sim, "o2");
      return say(item.phrase.includes("משקפ") ? "חמצן במשקפיים — מחובר." : "חמצן במסכה — מחובר.");
    case "o2Stop":
      record();
      setFlag(sim, "o2", false);
      return say("החמצן הופסק.");
    case "iv":
      record();
      if (flags.has("iv")) return say("כבר יש וריד פתוח.");
      setFlag(sim, "iv");
      return say(`וריד פתוח (${c.age < 1 ? "G24" : c.age < 8 ? "G22" : c.age < 16 ? "G20" : "G18"}) עם סליין לשמירת וריד.`);
    case "io":
      record();
      setFlag(sim, "io");
      return say("עירוי תוך־גרמי הותקן.");
    case "positionSit":
      record();
      if (!pulse || (v.gcs ?? 15) < 9) feedback(sim, "error", "הושבה של מטופל ללא הכרה / ללא דופק.");
      setFlag(sim, "sitting");
      return say("[[המטופל|המטופלת]] [[הושב|הושבה]].");
    case "positionSupine":
      record();
      setFlag(sim, "sitting", false);
      return say("[[המטופל|המטופלת]] [[הושכב|הושכבה]].");
    case "opa":
    case "suction":
    case "ngTube":
    case "needle":
    case "backup":
      record();
      return say(`✔ ${actionDef(id).label} — בוצע.`);
    case "bvm":
      record();
      if (pulse && (v.gcs ?? 15) >= 9) feedback(sim, "warn", "הנשמה במפוח למטופל בהכרה ונושם.");
      setFlag(sim, "bvm");
      return say("מנשימים במפוח עם חמצן.");
    case "cpap":
      record();
      if ((v.gcs ?? 15) < 13 || !pulse) feedback(sim, "error", "CPAP למטופל עם ירידה במצב ההכרה.");
      if (v.sbp !== null && v.sbp < 100) feedback(sim, "error", "CPAP למטופל עם לחץ דם סיסטולי נמוך מ־100.");
      setFlag(sim, "cpap");
      return say("CPAP מחובר.");
    case "intubation":
      record();
      if (pulse && (v.gcs ?? 15) >= 9 && !recentlySedated(sim)) feedback(sim, "warn", "אינטובציה למטופל בהכרה ללא תרופות להשריה (RSI).");
      setFlag(sim, "intubated");
      setFlag(sim, "bvm");
      return say("טובוס הוחדר. יש לוודא מיקום.");
    case "sga":
      record();
      setFlag(sim, "sga");
      setFlag(sim, "bvm");
      return say("נתיב אוויר סופראגלוטי הוחדר.");
    case "cpr":
      record();
      // Children: compressions are right for a pulse under 60 with poor perfusion (02-05).
      if (pulse && !(c.age < 16 && (v.hr ?? 100) < 60)) {
        feedback(sim, "error", "עיסויים למטופל עם דופק.");
        return say("[[למטופל|למטופלת]] יש דופק.");
      }
      say(flags.has("cpr") ? "ממשיכים סבב עיסויים של 2 דקות." : "מתחילים עיסויים — סבב של 2 דקות.");
      setFlag(sim, "cpr");
      return;
    case "chestThrusts":
      if (!pulse) return perform(content, sim, { kind: "action", id: "cpr", phrase: item.phrase }, out);
      record();
      return say("✔ לחיצות חזה — בוצע.");
    case "lucas":
      record();
      if (pulse) return say("[[למטופל|למטופלת]] יש דופק.");
      setFlag(sim, "cpr");
      setFlag(sim, "lucas");
      return say("מעסה אוטומטי מחובר ופועל.");
    case "cprStop":
      record();
      setFlag(sim, "cpr", false);
      setFlag(sim, "lucas", false);
      if (!pulse) feedback(sim, "warn", "הפסקת עיסויים בזמן שאין דופק.");
      return say("העיסויים הופסקו.");
    case "shock": {
      if (!flags.has("monitor")) return say("מדבקות הדפיברילציה אינן מחוברות.");
      const joules = item.joules ?? 200;
      record({ joules });
      if (pulse) feedback(sim, "error", "שוק לא מסונכרן למטופל עם דופק.");
      else if (!isShockable(def)) feedback(sim, "error", "שוק חשמלי בקצב שאינו בר־שוק.");
      return say(`⚡ שוק ${joules}J ניתן.`);
    }
    case "sync": {
      if (!flags.has("monitor")) return say("מדבקות הדפיברילציה אינן מחוברות.");
      if (item.joules === undefined) {
        sim.pending = { action: "sync", need: "joules" };
        return say("באיזו אנרגיה?");
      }
      record({ joules: item.joules });
      if (!pulse) feedback(sim, "error", "היפוך מסונכרן בדום לב — יש לתת דפיברילציה לא מסונכרנת.");
      else if ((v.gcs ?? 15) >= 9 && !recentlySedated(sim)) feedback(sim, "error", "היפוך חשמלי למטופל בהכרה ללא סדציה.");
      return say(`⚡ היפוך חשמלי מסונכרן ${item.joules}J בוצע.`);
    }
    case "pacing":
      if (!flags.has("monitor")) return say("מדבקות הקיצוב אינן מחוברות.");
      record();
      if (pulse && (v.gcs ?? 15) >= 9 && !recentlySedated(sim)) feedback(sim, "error", "קיצוב חיצוני למטופל בהכרה ללא סדציה / אנלגזיה.");
      setFlag(sim, "pacing");
      return say("הקוצב החיצוני הופעל.");
    case "vagal":
      record();
      return say("בוצע תמרון ולסלבה.");
    case "stimulate":
      record();
      return say("✔ גירוי מעורר — בוצע.");
    case "positionSide":
      record();
      setFlag(sim, "sitting", false);
      setFlag(sim, "side");
      return say("[[המטופל|המטופלת]] [[הושכב|הושכבה]] על הצד.");
    case "cool":
      record();
      setFlag(sim, "cooling");
      setFlag(sim, "warming", false);
      return say("מתחילים בקירור: התזת מים, קרח ומיזוג.");
    case "warm":
      record();
      setFlag(sim, "warming");
      setFlag(sim, "cooling", false);
      return say("הוסרו בגדים רטובים, [[המטופל מכוסה|המטופלת מכוסה]] בשמיכות והסביבה מחוממת.");
    case "uterineMassage":
      record();
      setFlag(sim, "uterineMassage");
      return say("מבצעים עיסוי רחם.");
    case "coughEncourage":
      record();
      return say(canTalk(sim) || (v.gcs ?? 15) >= 13 ? "[[המטופל|המטופלת]] [[משתעל|משתעלת]] בכוח." : "[[המטופל|המטופלת]] לא [[מסוגל|מסוגלת]] להשתעל.");
    case "tourniquet":
    case "pressure":
    case "pelvicBinder":
    case "chestSeal":
    case "splint":
    case "burnDress":
      record();
      setFlag(sim, id);
      return say(`✔ ${actionDef(id).label} — בוצע.`);
    case "cSpine":
      record();
      setFlag(sim, "cSpine");
      return say("✔ עמוד השדרה הצווארי מקובע.");
    case "prepareDelivery":
    case "deliver":
    case "cordCheck":
    case "dryBaby":
    case "cutCord":
    case "mcroberts":
    case "elevatePelvis":
    case "undress":
    case "decon":
    case "removeAllergen":
    case "pumpOff":
    case "removeRings":
    case "callPolice":
    case "restLimb":
    case "washBite":
    case "markSwelling":
    case "cutSuck":
    case "holdPresenting":
    case "wrapCord":
    case "cordPulse":
    case "pushCordBack":
    case "pullBaby":
    case "faceSpace":
    case "reassure":
    case "restrain":
    case "consultDoc":
    case "abdThrusts":
    case "backBlows":
    case "magill":
    case "strokeCenter":
      record();
      return say(`✔ ${actionDef(id).label} — בוצע.`);
    case "prealert":
      record();
      return say("בית החולים קיבל את הדיווח המקדים.");
    case "cath":
      record();
      return say("הקרדיולוג התורן קיבל את הדיווח ואת האק\"ג.");
    case "transport":
      if (sim.transportAt !== null) return say("אתם כבר בדרך לבית החולים.");
      record();
      sim.transportAt = sim.t;
      setFlag(sim, "transport");
      return say("🚑 [[המטופל|המטופלת]] [[הועבר|הועברה]] לאמבולנס ואתם בדרך לבית החולים. המשיכי בטיפול ובניטור; כתבי \"סיום\" כשתגיעו.");
    case "wait":
      record();
      return say("ממתינים ומעריכים שוב.");
    case "end":
      record();
      end(sim, sim.transportAt !== null ? "transport" : "end");
      return say("התרחיש הסתיים.");
  }
}
