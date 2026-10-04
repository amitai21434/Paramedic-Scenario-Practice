// What the student can measure, derived from the current state. This is the
// single place that turns a state into numbers and findings, and it enforces
// the physiology: no pulse ⇒ no BP, no SpO2 reading, unconscious, not
// breathing — whatever the template says.

import { resolve } from "./generate";
import type { Case, FindingKey, RhythmId, Sim, StateDef, Vitals } from "./types";

export const RHYTHMS: Record<RhythmId, { regular: boolean; wide: boolean; noPulseAlways?: boolean; shockable?: boolean }> = {
  "sinus": { regular: true, wide: false },
  "sinus-brady": { regular: true, wide: false },
  "sinus-tachy": { regular: true, wide: false },
  "junctional": { regular: true, wide: false },
  "avb1": { regular: true, wide: false },
  "avb2-1": { regular: false, wide: false },
  "avb2-2": { regular: false, wide: false },
  "avb3": { regular: true, wide: true },
  "afib": { regular: false, wide: false },
  "aflutter": { regular: true, wide: false },
  "svt": { regular: true, wide: false },
  "vt": { regular: true, wide: true, shockable: true },
  "torsades": { regular: false, wide: true, shockable: true },
  "vf": { regular: false, wide: true, noPulseAlways: true, shockable: true },
  "asystole": { regular: true, wide: false, noPulseAlways: true },
  "paced": { regular: true, wide: true },
};

/** A state's definition with its `extends` chain applied. */
export function stateDef(c: Case, id: string): StateDef {
  const def = c.template.states[id];
  if (!def) throw new Error(`Unknown state "${id}" in ${c.templateId}`);
  if (!def.extends) return def;
  const parent = stateDef(c, def.extends);
  return {
    ...parent,
    ...def,
    findings: { ...parent.findings, ...def.findings },
    answers: { ...parent.answers, ...def.answers },
    // Rules, entry text and endings belong to the state that declares them.
    rules: def.rules,
    say: def.say,
    end: def.end,
  };
}

export function hasPulse(def: StateDef): boolean {
  const rhythm = def.rhythm ?? "sinus";
  if (RHYTHMS[rhythm].noPulseAlways) return false;
  return def.pulse ?? true;
}

export function isShockable(def: StateDef): boolean {
  return !hasPulse(def) && !!RHYTHMS[def.rhythm ?? "sinus"].shockable;
}

export function current(sim: Sim): StateDef {
  return stateDef(sim.case, sim.state);
}

/** Vitals as they'd be measured right now (support like O2 applied, physiology enforced). */
export function effectiveVitals(sim: Sim): Vitals {
  const def = current(sim);
  const v = { ...sim.vitals };
  const flags = new Set(sim.flags);

  if (!hasPulse(def)) {
    const cpr = flags.has("cpr");
    return {
      ...v,
      hr: def.rhythm === "vf" ? null : def.rhythm === "asystole" ? 0 : v.hr, // electrical rate only
      sbp: null,
      dbp: null,
      spo2: null,
      rr: flags.has("bvm") || flags.has("intubated") ? 10 : 0,
      gcs: 3,
      etco2: cpr ? 14 + (sim.case.seed % 6) : 3,
    };
  }

  // Oxygen support lifts saturation toward the high 90s, never above it.
  if (v.spo2 !== null) {
    const boost = flags.has("intubated") || flags.has("cpap") ? 8 : flags.has("o2") ? 4 : 0;
    v.spo2 = Math.min(Math.max(v.spo2, Math.min(98, v.spo2 + boost)), 100);
  }
  if (v.sbp !== null && v.dbp !== null && v.dbp >= v.sbp) v.dbp = Math.round(v.sbp * 0.6);
  if (v.gcs !== null) v.gcs = Math.max(3, Math.min(15, v.gcs));
  return v;
}

export type Snapshot = { def: StateDef; vitals: Vitals; pulse: boolean };

export function snapshot(sim: Sim): Snapshot {
  const def = current(sim);
  return { def, vitals: effectiveVitals(sim), pulse: hasPulse(def) };
}

/** Lowest normal systolic BP for age (protocol 04-04): 70 under 1, 70 + 2×age up to 10, then 90. */
export function minSbp(age: number): number {
  if (age < 1) return 70;
  if (age < 10) return 70 + 2 * Math.floor(age);
  return 90;
}

/** The finding text for a body-system check: the state's own text, else a default consistent with the vitals. */
export function finding(sim: Sim, key: FindingKey): string {
  const { def, vitals, pulse } = snapshot(sim);
  const own = def.findings?.[key];
  if (own !== undefined) return resolve(own, sim.case);
  return resolve(defaultFinding(key, vitals, pulse, new Set(sim.flags), sim.case.age), sim.case);
}

function defaultFinding(key: FindingKey, v: Vitals, pulse: boolean, flags: Set<string>, age: number): string {
  const gcs = v.gcs ?? 15;
  const shock = v.sbp !== null && v.sbp < minSbp(age);
  if (!pulse) {
    const arrest: Partial<Record<FindingKey, string>> = {
      general: "[[המטופל|המטופלת]] שוכב[[|ת]] ללא תגובה, [[כחלחל|כחלחלה]]",
      airway: flags.has("intubated") ? "טובוס במקום" : "נתיב אוויר פתוח לאחר פתיחה ידנית",
      breathing: flags.has("bvm") || flags.has("intubated") ? "ללא נשימה עצמונית, מונשם[[|ת]]" : "ללא נשימה (נשימות אגונליות בודדות)",
      lungs: flags.has("bvm") || flags.has("intubated") ? "כניסת אוויר דו־צדדית בהנשמה" : "אין נשימה עצמונית",
      skin: "חיוור, כחלחל",
      capRefill: "לא ניתן להעריך",
      pupils: "רחבים, תגובה איטית לאור",
      neuro: "[[אינו מגיב|אינה מגיבה]]",
    };
    return arrest[key] ?? "ללא ממצא נוסף";
  }
  switch (key) {
    case "general":
      if (gcs <= 8) return "[[המטופל|המטופלת]] שוכב[[|ת]] ללא תגובה";
      if (gcs < 14) return "[[המטופל|המטופלת]] [[מבולבל|מבולבלת]] ו[[מנומנם|מנומנמת]]";
      return shock ? "[[המטופל|המטופלת]] ער[[|ה]], [[חיוור|חיוורת]] ו[[מזיע|מזיעה]]" : "[[המטופל|המטופלת]] ער[[|ה]] ו[[מדבר|מדברת]]";
    case "airway":
      return gcs <= 8 ? "נחירות, נתיב אוויר בסכנה" : "נתיב אוויר פתוח, [[מדבר|מדברת]]";
    case "breathing": {
      const rr = v.rr ?? 16;
      if (rr >= 28) return "טכיפנאה עם מאמץ נשימתי ניכר ושימוש בשרירי עזר";
      if (rr > 22) return "טכיפנאה קלה";
      if (rr < 10) return "נשימות איטיות ושטחיות";
      return "נשימה סדירה, ללא מאמץ";
    }
    case "lungs":
      return "כניסת אוויר טובה דו־צדדית, ללא קולות נלווים";
    case "skin":
      return shock ? "חיוור, קר ומזיע" : "ורוד, חם ויבש";
    case "capRefill":
      return shock ? "מעל 3 שניות" : "פחות מ־2 שניות";
    case "jvd":
      return "אין גודש ורידי צוואר";
    case "edema":
      return "אין בצקות בגפיים התחתונות";
    case "chest":
      return "בית חזה סימטרי, ללא סימני חבלה";
    case "heart":
      return "קולות לב סדירים, ללא אוושות";
    case "abdomen":
      return "בטן רכה, לא רגישה";
    case "pupils":
      return "אישונים שווים ומגיבים לאור";
    case "vaginal":
      return "ללא דימום";
    case "mouth":
      return "חלל הפה נקי, ללא נפיחות";
    case "newborn":
      return "אין יילוד";
    case "head":
      return "ללא סימני חבלה בראש ובפנים";
    case "neck":
      return "קנה במרכז, ללא גודש ורידי צוואר, ללא רגישות";
    case "pelvis":
      return "אגן יציב, לא רגיש";
    case "limbs":
      return "ללא עיוותים או סימני חבלה בגפיים";
    case "back":
      return "ללא סימני חבלה או רגישות בגב";
    case "burns":
      return "אין כוויות";
    case "neuro":
      return gcs <= 8 ?"לא ניתן לבצע — [[אינו משתף|אינה משתפת]] פעולה" : "ללא סימנים צדדיים, כוח שווה בארבע הגפיים";
  }
}

export function consciousnessText(gcs: number): string {
  if (gcs >= 15) return "ער[[|ה]] ו[[מתמצא|מתמצאת]] (A)";
  if (gcs >= 13) return "ער[[|ה]] אך [[מבולבל|מבולבלת]] (A)";
  if (gcs >= 9) return "[[מגיב|מגיבה]] לקול (V)";
  if (gcs >= 6) return "[[מגיב|מגיבה]] לכאב בלבד (P)";
  return "[[אינו מגיב|אינה מגיבה]] (U)";
}
