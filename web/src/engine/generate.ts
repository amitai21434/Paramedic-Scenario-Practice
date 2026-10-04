// Template + seed → one concrete patient. Everything random is drawn from a
// seeded generator, so a case can be rebuilt exactly from (template, seed).

import type { Case, CaseTemplate, Range, Sex, Text } from "./types";

/** mulberry32: small, fast, good enough for picking scenario details. */
export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: <T>(items: T[]): T => items[Math.floor(next() * items.length)],
    weighted: <T extends { w?: number }>(items: T[]): T => {
      const total = items.reduce((s, i) => s + (i.w ?? 1), 0);
      let r = next() * total;
      for (const i of items) {
        r -= i.w ?? 1;
        if (r < 0) return i;
      }
      return items[items.length - 1];
    },
  };
}
export type Rng = ReturnType<typeof rng>;

/** A value in the range, rounded sensibly for the vital (one decimal for temp). */
export function roll(r: Rng, range: Range | undefined, decimals = 0): number | null {
  if (range === undefined) return null;
  if (typeof range === "number") return range;
  const v = range[0] + r.next() * (range[1] - range[0]);
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Objects merge key by key; arrays and values are replaced. */
export function deepMerge<T>(base: T, over: unknown): T {
  if (!isObject(base) || !isObject(over)) return (over === undefined ? base : over) as T;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = k in out ? deepMerge(out[k], v) : v;
  return out as T;
}

/** Resolves a Text for this patient: facts choose if/then/else, "[[m|f]]" picks by sex, {age}/{weight} fill in. */
/** "8 חודשים" for babies, "5" for everyone else (templates write "[[בן|בת]] {age}"). */
export function ageText(age: number): string {
  if (age >= 2) return String(Math.floor(age));
  const months = Math.round(age * 12);
  return months <= 1 ? (months === 0 ? "יום" : "חודש") : `${months} חודשים`;
}

/** Typical weight for age (used when a template doesn't set one). */
export function weightForAge(r: Rng, age: number, sex: Sex): number {
  if (age < 1) return Math.round((3.5 + age * 12 * 0.5) * 10) / 10;
  if (age <= 10) return Math.round((age + 4) * 2 + r.int(-2, 2));
  if (age < 16) return r.int(30, 55);
  return sex === "m" ? r.int(70, 100) : r.int(55, 85);
}

export function resolve(text: Text | undefined, c: Pick<Case, "sex" | "facts" | "age" | "weight">): string {
  if (text === undefined) return "";
  const s = typeof text === "string" ? text : c.facts.includes(text.if) ? text.then : text.else;
  // {who}: how the examiner refers to this patient (the baby / the child / the patient).
  const who = c.age < 1 ? "[[התינוק|התינוקת]]" : c.age < 16 ? "[[הילד|הילדה]]" : "[[המטופל|המטופלת]]";
  return s
    .replace(/\{who\}/g, who)
    .replace(/\[\[([^|\]]*)\|([^\]]*)\]\]/g, (_, m, f) => (c.sex === "m" ? m : f))
    .replace(/\{age\}/g, ageText(c.age))
    .replace(/\{weight\}/g, String(c.weight));
}

/** The template with one variant merged in. */
export function withVariant(base: CaseTemplate, variantId: string | null): CaseTemplate {
  const variant = base.variants?.find((v) => v.id === variantId);
  return variant ? deepMerge({ ...base, variants: undefined }, { ...variant, id: base.id }) : base;
}

/** `variantId` forces a variant (tests, admin preview); otherwise one is picked at random by weight. */
export function generate(base: CaseTemplate, seed: number, variantId?: string): Case {
  const r = rng(seed);
  const picked = base.variants?.length ? r.weighted(base.variants) : null;
  const variant = variantId ? (base.variants?.find((v) => v.id === variantId) ?? null) : picked;
  const t = withVariant(base, variant?.id ?? null);

  const sex: Sex = r.next() < (t.patient.male ?? 0.5) ? "m" : "f";
  const age = t.patient.ageMonths
    ? r.int(t.patient.ageMonths[0], t.patient.ageMonths[1]) / 12
    : r.int(t.patient.age[0], t.patient.age[1]);
  const weight = t.patient.weight ? r.int(...t.patient.weight) : weightForAge(r, age, sex);

  const background = r.weighted(t.patient.backgrounds);
  const allergy = t.patient.allergies?.length ? r.weighted(t.patient.allergies) : { text: "אין רגישויות ידועות" };
  const facts = [
    ...(background.facts ?? []),
    ...(allergy.facts ?? []),
    ...Object.entries(t.patient.facts ?? {})
      .filter(([, p]) => r.next() < p)
      .map(([f]) => f),
  ];
  // Sex-specific facts, written "pde5:m".
  const kept = facts.filter((f) => !f.includes(":") || f.endsWith(`:${sex}`)).map((f) => f.split(":")[0]);

  const vars = Object.fromEntries(
    Object.entries(t.vars ?? {}).map(([k, v]) => [k, Array.isArray(v) ? r.int(v[0], v[1]) : r.pick(v.oneOf)]),
  );
  // Which dispatch/scene pair was used, as a fact ("opening1") so answers can match it.
  const opening = r.int(0, t.dispatch.length - 1);
  kept.push(`opening${opening}`);
  const who = { sex, facts: kept, age, weight };

  return {
    seed,
    templateId: base.id,
    variantId: variant?.id ?? null,
    title: variant?.title ?? t.title,
    station: t.station,
    protocols: t.protocols,
    age,
    sex,
    weight,
    facts: kept,
    allergyDrug: allergy.allergy ?? null,
    vars,
    history: resolve(background.history, who),
    meds: resolve(background.meds, who),
    allergies: resolve(allergy.text, who),
    dispatch: resolve(t.dispatch[opening], who),
    // Scenes pair with dispatches by position when there's one per dispatch ("at home" ↔ the living room).
    scene: resolve(t.scene.length === t.dispatch.length ? t.scene[opening] : r.pick(t.scene), who),
    bystander: t.bystander ? resolve(t.bystander, who) : null,
    template: t,
  };
}
