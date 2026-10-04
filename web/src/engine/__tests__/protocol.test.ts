// By-the-book play-throughs for storylines not covered elsewhere, checked
// against the MDA protocol book: no errors and every checklist item done.
// Skipped without the content folder.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { debrief } from "../debrief";
import { startSim, step } from "../engine";
import { generate } from "../generate";
import type { Case, Content, Sim } from "../types";

const root = path.resolve(import.meta.dirname, "../../../..");
const hasContent = fs.existsSync(path.join(root, "content"));
const content: Content = hasContent
  ? JSON.parse(execFileSync(process.execPath, [path.join(root, "reference/content.mjs")], { encoding: "utf8" }))
  : { cases: [], drugs: {}, protocols: {} };

function seedWhere(id: string, variant: string, ok: (c: Case) => boolean = () => true): number {
  const t = content.cases.find((c) => c.id === id)!;
  for (let seed = 1; seed < 5000; seed++) {
    const c = generate(t, seed, variant);
    if (!c.allergyDrug && ok(c)) return seed;
  }
  throw new Error("no seed");
}

/** Lines may use {w} for the patient's weight. */
function play(key: string, lines: string[], ok?: (c: Case) => boolean): Sim {
  const [id, variant] = key.split("/");
  let sim = startSim(content, id, seedWhere(id, variant, ok), variant);
  for (const line of lines) {
    const w = sim.case.weight;
    const filled = line
      .replace("{w100}", String(Math.round(w) / 100))
      .replace("{w20}", String(w * 20))
      .replace("{w15}", String(w * 15))
      .replace("{w2}", String(w * 2))
      .replace("{w}", String(w));
    const r = step(content, sim, filled);
    expect(r.understood, `not understood: ${line}`).toBe(true);
    sim = r.sim;
  }
  return sim;
}

const errors = (sim: Sim) => sim.feedback.filter((f) => f.kind === "error").map((f) => f.text);
const missed = (sim: Sim) => debrief(content, sim).checklist.filter((i) => i.doneAt === null).map((i) => i.label);
const waits = (n: number) => Array.from({ length: n }, () => "ממתין");
const male = (c: Case) => c.sex === "m";
const noFacts = (...f: string[]) => (c: Case) => !f.some((x) => c.facts?.includes(x));

const SCRIPTS: [string, string[], ((c: Case) => boolean)?][] = [
  ["tachy/vtStable", ["מחבר מוניטור", "לחץ דם", "יש אלרגיות?", "פותח וריד", 'אק"ג 12 ערוצים', "אמיודרון 150 מג IV", "דיווח מקדים", "מפנה לבית חולים"]],
  ["tachy/vtUnstable", ["מחבר מוניטור", "לחץ דם", "יש אלרגיות?", "חמצן", "פותח וריד", "דורמיקום 2.5 מג IV", "היפוך חשמלי מסונכרן 100 ג'ול", ...waits(1), 'אק"ג 12 ערוצים', "מפנה לבית חולים"]],
  ["tachy/afib", ["מחבר מוניטור", "לחץ דם", "יש אלרגיות?", "פותח וריד", 'אק"ג 12 ערוצים', "מתי התחיל?", "מטופרולול 2.5 מג IV", "לחץ דם", "מפנה לבית חולים"]],
  ["pulmonaryEdema/cardiogenic", ["חמצן", "מוניטור וסטורציה", "לחץ דם", "יש אלרגיות?", 'אק"ג 12 ערוצים', "אספירין 300 מג בלעיסה", "פותח וריד", 'דופמין 10 מקג/ק"ג/דקה', "דיווח לחדר צנתורים"]],
  ["sepsis/urosepsis", ["לחץ דם", "קצב נשימה", "הכרה", "מדידת חום", "סוכר", "חמצן", "יש אלרגיות?", "פותח וריד", "הרטמן 500 מל IV", "אקמול 1 גרם IV", "דיווח מקדים", "מפנה לבית חולים"], (c) => c.vars?.refractory !== 1],
  ["sepsis/pneumonia", ["האזנה לריאות", "מדידת חום", "חמצן", "לחץ דם", "קצב נשימה", "יש אלרגיות?", "פותח וריד", "מלח 250 מל IV", "אקמול 1 גרם IV", "סוכר", "מפנה לבית חולים"]],
  ["stroke/lvo", ["בדיקה נוירולוגית", "מתי התחיל?", "סוכר", "אילו תרופות?", "מה הרקע?", "לחץ דם", "מחבר מוניטור", "פותח וריד", "מרים את ראש המיטה ל-30 מעלות", "דיווח מקדים", "מפנה למרכז צנתור מוחי"]],
  ["stroke/hypertensive", ["בדיקה נוירולוגית", "מתי התחיל?", "סוכר", "לחץ דם", "יש אלרגיות?", "פותח וריד", "מתייעץ עם רופא המוקד", "לבטלול 20 מג IV", ...waits(1), "לחץ דם", "מרים את ראש המיטה ל-30 מעלות", "דיווח מקדים", "מפנה"]],
  ["copd/exacerbation", ["מושיב", "חמצן", "סטורציה", "קפנוגרפיה", "האזנה לריאות", "יש אלרגיות?", "ונטולין 2.5 מג ואירובנט 0.5 מג בשאיפה", "פותח וריד", "סולומדרול 125 מג", 'אק"ג', "מדידת חום", "מפנה"]],
  ["loc/hypoSeizure", ["מניח על הצד", "חמצן", "סוכר", "בדיקת בטן", "מנתק את משאבת האינסולין", "פותח וריד", "גלוקוז 25 גרם IV", ...waits(1), "סוכר", "מה הרקע?"]],
  ["loc/opioidCold", ["מנשים במפוח עם חמצן", "סוכר", "פותח וריד", "נרקן 0.4 מג IV", "מודד חום", "מסיר בגדים רטובים ומחמם", "מוניטור", "מפנה"]],
  ["headInjury/moderate", ["בודק זירה", "מקבע צוואר", "GCS ואישונים", "אילו תרופות לוקח?", "סוכר", "סטורציה", "יש אלרגיות?", "פותח וריד", "הקסקפרון 1 גרם IV", ...waits(1), "GCS", "מפנה", "דיווח מקדים"]],
  ["hypothermia/", ["מודד חום רקטלי", "מסיר בגדים רטובים ומחמם בשמיכות", "סוכר", "מחבר מוניטור", "חמצן", "פותח וריד", "מלח מחומם 500 מל", "בדיקה גופנית", "מפנה"]],
];

describe.skipIf(!hasContent)("protocol play-throughs", () => {
  for (const [key, lines, ok] of SCRIPTS) {
    it(key, () => {
      const sim = play(key.replace(/\/$/, ""), lines, ok);
      expect(errors(sim)).toEqual([]);
      expect(missed(sim)).toEqual([]);
    });
  }

  it("ACS anterior with VF: STEMI care, then the VF algorithm to ROSC and post-ROSC care", () => {
    let sim = play("acs/anteriorVf", [
      "מחבר מוניטור", 'אק"ג 12 ערוצים', "לחץ דם", "חמצן", "יש אלרגיות?", "לקחת ויאגרה?", "אספירין 300 מג בלעיסה", "פותח וריד", "דיווח לחדר צנתורים",
    ], (c) => male(c) && noFacts("pepticUlcer", "aspirinAllergy", "pde5")(c));
    for (let i = 0; i < 12 && sim.state !== "vf"; i++) sim = step(content, sim, "ממתין").sim;
    expect(sim.state).toBe("vf");
    for (const l of ["מתחיל עיסויים", "בדיקת קצב", "שוק 200", "החייאה", "שוק 300", "אדרנלין 1 מג IV", "החייאה", "שוק 360", "אמיודרון 300 מג IV", "החייאה", "מנשים במפוח", "קפנוגרפיה"]) {
      sim = step(content, sim, l).sim;
    }
    for (let i = 0; i < 4 && sim.state === "vf"; i++) {
      sim = step(content, sim, "שוק 360").sim;
      sim = step(content, sim, "החייאה").sim;
    }
    expect(sim.state).toBe("rosc");
    for (const l of ["בודק דופק", "מלח 250 מל IV", "אמיודרון 1 מג לדקה בטפטוף", 'אק"ג 12 ערוצים']) sim = step(content, sim, l).sim;
    expect(errors(sim)).toEqual([]);
    expect(missed(sim)).toEqual([]);
  });

  it("PEA from hyperkalemia: early adrenaline and bicarbonate; calcium is flagged", () => {
    let sim = play("arrest/peaHyperK", [
      "מתחיל עיסויים", "מחבר מוניטור", "בודק דופק", "פותח IO", "אדרנלין 1 מג IO", "מה קרה? מה הרקע?", 'ביקרבונט {w} מאק"ו IO', "מנשים במפוח", "החייאה", "קפנוגרפיה",
    ]);
    expect(sim.state).toBe("rosc");
    for (const l of ["בודק דופק", "מלח 250 מל IO", 'אק"ג 12 ערוצים']) sim = step(content, sim, l).sim;
    expect(errors(sim)).toEqual([]);
    expect(missed(sim)).toEqual([]);
    sim = step(content, sim, "קלציום גלוקונט 1 גרם IV").sim;
    expect(errors(sim).join()).toMatch(/קלציום/);
  });

  it("furosemide is checked per kg (1 mg/kg, up to 120 mg)", () => {
    const sim = play("pulmonaryEdema/hypertensive", ["פותח וריד", "פוסיד {w} מג IV"], (c) => c.weight <= 120);
    expect(errors(sim)).toEqual([]);
    const flat = play("pulmonaryEdema/hypertensive", ["פותח וריד", "פוסיד 40 מג IV"], (c) => c.weight >= 60);
    expect(errors(flat).join()).toMatch(/מינון שגוי/);
  });

  it("crush, trapped: fluids before release keep the potassium down", () => {
    let sim = play("crush/trapped", ["בודק זירה", "מוריד טבעות", "יש אלרגיות?", "פותח וריד", "סליין 1 ליטר לשעה", "מחבר מוניטור", "אקג 12", "פנטניל 100 מקג IV"]);
    for (let i = 0; i < 12 && sim.state === "s1"; i++) sim = step(content, sim, "ממתין").sim;
    expect(sim.state).toBe("released");
    for (const l of ["בדיקת גפיים", "דיווח מקדים", "מפנה"]) sim = step(content, sim, l).sim;
    expect(errors(sim)).toEqual([]);
    expect(missed(sim)).toEqual([]);
  });

  it("crush, trapped without fluids: hyperkalemia after release, treated with calcium", () => {
    let sim = play("crush/trapped", ["בודק זירה", "מחבר מוניטור"]);
    for (let i = 0; i < 12 && sim.state === "s1"; i++) sim = step(content, sim, "ממתין").sim;
    expect(sim.state).toBe("hyperK");
    for (const l of ["אקג 12", "פותח וריד", "סליין 1000 מל", "מתייעץ עם רופא המוקד", "קלציום גלוקונט 1 גרם IV"]) sim = step(content, sim, l).sim;
    expect(sim.state).toBe("treated");
    expect(missed(sim)).toContain("עירוי סליין (1 L/hr) — לפני שחרור הרגל");
  });

  it("crush, freed an hour ago: hyperkalemia treated by the book", () => {
    const sim = play("crush/freed", [
      "בודק גפיים", "מתי זה קרה?", "מחבר מוניטור", "יש אלרגיות?", "פותח וריד", "סליין 1000 מל לשעה", "אקג 12", "מתייעץ עם רופא המוקד",
      "קלציום גלוקונט 1 גרם IV", "ביקרבונט 50 מאק בטפטוף", "ונטולין 5 מג באינהלציה", "דיווח מקדים", "מפנה",
    ]);
    expect(sim.state).toBe("treated");
    expect(errors(sim)).toEqual([]);
    expect(missed(sim)).toEqual([]);
  });

  it("delirium from infection: calm, look for the cause, consult, then low-dose sedation", () => {
    const sim = play("delirium/infection", [
      "בודק זירה", "מנסה להרגיע אותו", "מה הרקע?", "מתי זה התחיל?", "מה קרה לפני?", "סוכר", "מודד חום", "סטורציה", "בדיקת ראש",
      "יש אלרגיות?", "פותח וריד", "מתייעץ עם רופא המוקד", "דורמיקום 2.5 מג IV", "סטורציה", "לחץ דם", "מפנה",
    ]);
    expect(sim.state).toBe("calm");
    expect(errors(sim)).toEqual([]);
    expect(missed(sim)).toEqual([]);
  });

  it("violent stimulant delirium: police, IM ketamine, monitoring; an IV first is flagged", () => {
    const sim = play("delirium/stimulant", [
      "מזעיק משטרה ושומר מרחק", "מה הוא לקח?", "קטמין {w2} מג לשריר", "סטורציה", "לחץ דם", "סוכר", "מודד חום", "פותח וריד", "מפנה",
    ].map((l) => l), undefined);
    expect(sim.state).toBe("sedated");
    expect(errors(sim)).toEqual([]);
    expect(missed(sim)).toEqual([]);
    const early = play("delirium/stimulant", ["פותח וריד"]);
    expect(errors(early).join()).toMatch(/משתולל/);
  });

  it("snakebite, local: rest, rings off, wash, mark, pain relief; a tourniquet or ice is flagged", () => {
    const sim = play("snakebite/local", [
      "בודק זירה", "מנוחה מלאה, שלא יזוז", "מסיר טבעות", "בודק גפיים", "שוטף את מקום ההכשה במים", "מסמן את גבול הנפיחות", "איך נראה הנחש?",
      "פותח וריד ביד השנייה", "איפה כואב?", "יש אלרגיות?", "פנטניל 100 מקג IV", "בודק גפיים", "מפנה",
    ]);
    expect(errors(sim)).toEqual([]);
    expect(missed(sim)).toEqual([]);
    const wrong = play("snakebite/local", ["חוסם עורקים", "מקרר עם קרח"]);
    expect(errors(wrong).length).toBe(2);
  });

  it("snakebite, systemic: fluids restore perfusion", () => {
    const sim = play("snakebite/systemic", [
      "משכיב במנוחה מלאה", "לחץ דם", "בודק עור", "מסיר טבעות", "חמצן", "פותח וריד", "סליין 250 מל", "סליין 250 מל", "מוניטור",
      "יש אלרגיות?", "זופרן 4 מג IV", "איך נראה הנחש?", "דיווח מקדים", "מפנה",
    ]);
    expect(sim.state).toBe("better");
    expect(errors(sim)).toEqual([]);
    expect(missed(sim)).toEqual([]);
  });

  it("Dead Sea, conscious: oxygen, warming, early transport, fluids and furosemide on the way", () => {
    const sim = play("deadSea/conscious", [
      "חמצן", "סטורציה ומוניטור", "האזנה לריאות", "מודד חום", "מפשיט, מייבש ומחמם", "מפנה", "פותח וריד", "סליין 500 מל", "יש אלרגיות?",
      "פוסיד {w} מג IV", "זופרן 4 מג IV", "דיווח מקדים",
    ], (c) => c.weight <= 120);
    expect(sim.state).toBe("better");
    expect(errors(sim)).toEqual([]);
    expect(missed(sim)).toEqual([]);
  });

  it("Dead Sea, severe: airway, warming, furosemide", () => {
    const sim = play("deadSea/severe", [
      "מנשים במפוח", "שאיבת הפרשות", "מוניטור", "קטמין 2 מג לקג", "אינטובציה", "קפנוגרפיה", "מפשיט ומחמם", "מפנה", "פותח וריד",
      "סליין 500 מל", "פוסיד {w} מג IV", "דיווח מקדים",
    ], (c) => c.weight <= 120);
    expect(sim.state).toBe("ventilated");
    expect(missed(sim)).toEqual([]);
  });

  it("cord prolapse: oxygen, pelvis up, hold back the presenting part, immediate transport", () => {
    let sim = play("obstetric/cordProlapse", [
      "בדיקת פרינאום", "חמצן", "הרמת אגן היולדת", "יוצר מרווח בין החבל לראש", "עוטף את החבל בפד לח", "מתקשר לחדר לידה", "מפנה", "בודק דופק בחבל", "דיווח מקדים",
    ]);
    expect(sim.state).toBe("relieved");
    expect(errors(sim)).toEqual([]);
    expect(missed(sim)).toEqual([]);
    sim = step(content, sim, "מחזיר את החבל פנימה").sim;
    expect(errors(sim).join()).toMatch(/להחזיר את החבל/);
  });

  for (const stuck of [0, 1]) {
    it(`breech (${stuck ? "head stuck" : "uncomplicated"}): semi-sitting, hands off, ${stuck ? "airway space and urgent transport" : "newborn check"}`, () => {
      let sim = play("obstetric/breech", ["מה הרקע?", "בדיקת פרינאום", "מכין ערכת לידה", "חצי ישיבה", "יש אלרגיות?", "קבלת לידה", "ממתין"], (c) => c.vars.headStuck === stuck);
      expect(sim.state).toBe(stuck ? "headStuck" : "born");
      const rest = stuck
        ? ["מרחיק את פני התינוק מהדופן", "מתקשר לחדר לידה", "מפנה", "ממתין", "ממתין", "ממתין", "מייבש את התינוק", "מנשים במפוח", "אפגר"]
        : ["מייבש את התינוק", "אפגר", "מתקשר לחדר לידה", "מפנה"];
      for (const l of rest) sim = step(content, sim, l).sim;
      expect(sim.state).toBe("born");
      expect(errors(sim)).toEqual([]);
      expect(missed(sim)).toEqual([]);
    });
  }

  it("symptomatic sinus bradycardia responds to atropine", () => {
    const sim = play("bradycardia/atropine", ["מוניטור", "לחץ דם", "איך אתה מרגיש?", "חמצן", "אקג 12", "פותח וריד", "יש אלרגיות?", "אטרופין 1 מג IV", "לחץ דם", "מפנה"]);
    expect(sim.state).toBe("better");
    expect(errors(sim)).toEqual([]);
    expect(missed(sim)).toEqual([]);
  });

  it("Mobitz II: atropine doesn't help; pacing with ketamine sedation does", () => {
    const sim = play("bradycardia/mobitz", [
      "מוניטור", "לחץ דם", "בודק הכרה", "חמצן", "אקג 12", "פותח וריד", "יש אלרגיות?", "אטרופין 1 מג IV", "קטמין 0.5 מג לקג IV", "קיצוב חיצוני", "דיווח מקדים", "מפנה",
    ]);
    expect(sim.state).toBe("paced");
    expect(errors(sim)).toEqual([]);
    expect(missed(sim)).toEqual([]);
  });

  it("upper GI bleed: lie flat, fluids, history of blood and anticoagulants", () => {
    const sim = play("giBleed/", [
      "לחץ דם", "בודק עור", "משכיב", "חמצן", "מה קרה?", "אילו תרופות?", "פותח וריד", "סליין 500 מל", "מוניטור", "סוכר", "לחץ דם", "דיווח מקדים", "מפנה",
    ]);
    expect(sim.state).toBe("better");
    expect(errors(sim)).toEqual([]);
    expect(missed(sim)).toEqual([]);
  });

  it("diving injury with neurogenic shock: immobilise, breathing, neuro exam, fluids", () => {
    const sim = play("spinal/neurogenic", [
      "קיבוע ידני של הצוואר", "הערכת נשימה", "חמצן", "בדיקה נוירולוגית", "לחץ דם", "בודק דופק", "פותח וריד", "סליין 250 מל", "סליין 250 מל",
      "מכסה בשמיכות", "דיווח מקדים", "מפנה",
    ]);
    expect(sim.state).toBe("supported");
    expect(errors(sim)).toEqual([]);
    expect(missed(sim)).toEqual([]);
  });

  it("walking after a rear-end crash with neck tenderness: still immobilised", () => {
    let sim = play("spinal/ambulatory", ["בודק זירה", "מה קרה?", "בודק צוואר", "בדיקה נוירולוגית", "צווארון, מנייח ראש ולוח גב", "איפה כואב?", "בדיקה נוירולוגית", "מפנה"]);
    expect(errors(sim)).toEqual([]);
    expect(missed(sim)).toEqual([]);
    sim = play("spinal/ambulatory", ["מושיב אותו"]);
    expect(errors(sim).join()).toMatch(/לקבע/);
  });

  it("vomiting with dehydration: fluids by weight and ondansetron", () => {
    const sim = play("vomiting/gastro", [
      "בודק דופק", "בודק ריריות בפה", "לחץ דם", "מה קרה?", "בודק בטן", "סוכר", "יש אלרגיות?", "פותח וריד", "סליין 1000 מל", "זופרן 4 מג IV", "מפנה",
    ]);
    expect(errors(sim)).toEqual([]);
    expect(missed(sim)).toEqual([]);
  });

  it("vomiting over 65: monitor before ondansetron", () => {
    const sim = play("vomiting/elderly", [
      "בודק דופק", "בודק עור", "לחץ דם", "אילו תרופות?", "בודק בטן", "מוניטור", "יש אלרגיות?", "פותח וריד", "סליין 500 מל", "זופרן 4 מג IV", "מפנה",
    ]);
    expect(errors(sim)).toEqual([]);
    expect(missed(sim)).toEqual([]);
  });

  it("respiratory failure fit for CPAP", () => {
    const sim = play("respFailure/cpap", ["חמצן", "סטורציה", "קצב נשימה", "לחץ דם", "האזנה לריאות", "קפנוגרפיה", "CPAP", "מודד חום", "דיווח מקדים", "מפנה"]);
    expect(sim.state).toBe("better");
    expect(errors(sim)).toEqual([]);
    expect(missed(sim)).toEqual([]);
  });

  it("respiratory failure with vomiting and low BP: CPAP is flagged, airway instead", () => {
    const sim = play("respFailure/noCpap", [
      "חמצן", "סטורציה", "קצב נשימה", "לחץ דם", "שאיבת הפרשות", "מנשים במפוח", "פותח וריד", "סליין 250 מל", "קטמין 1 מג לקג", "אינטובציה", "דיווח מקדים", "מפנה",
    ]);
    expect(sim.state).toBe("ventilated");
    expect(errors(sim)).toEqual([]);
    expect(missed(sim)).toEqual([]);
    const wrong = play("respFailure/noCpap", ["CPAP"]);
    expect(errors(wrong).join()).toMatch(/CPAP/);
  });

  it("renal colic, severe pain: fentanyl; moderate pain: tramadol (fentanyl flagged)", () => {
    const severe = play("renalColic/severe", [
      "כמה כואב מ1 עד 10?", "בודק בטן", "לחץ דם", "בודק דופק", "יש אלרגיות?", "פותח וריד", "פנטניל 100 מקג IV", "זופרן 4 מג IV", "כמה כואב עכשיו?", "מפנה",
    ], (c) => c.weight >= 50 && c.weight <= 100);
    expect(severe.state).toBe("relieved");
    expect(errors(severe)).toEqual([]);
    expect(missed(severe)).toEqual([]);
    const moderate = play("renalColic/moderate", ["כמה כואב?", "בודק גב", "יש אלרגיות?", "טרמדקס 100 מג", "ממתין", "כמה כואב עכשיו?", "מפנה"]);
    expect(moderate.state).toBe("relieved");
    expect(errors(moderate)).toEqual([]);
    expect(missed(moderate)).toEqual([]);
    const over = play("renalColic/moderate", ["יש אלרגיות?", "פותח וריד", "פנטניל 100 מקג IV"]);
    expect(errors(over).join()).toMatch(/כאב בינוני/);
  });

  it("conscious hypoglycemia: glucogel by mouth, then recheck", () => {
    const sim = play("loc/hypoConscious", ["בודק הכרה", "סוכר", "יש אלרגיות?", "גלוקוג'ל 15 גרם", "ממתין", "סוכר", "אילו תרופות?", "מפנה"]);
    expect(sim.state).toBe("awake");
    expect(errors(sim)).toEqual([]);
    expect(missed(sim)).toEqual([]);
  });

  it("asystole from an opioid overdose: CPR, airway, early adrenaline, naloxone, post-ROSC care", () => {
    let sim = play("arrest/asystoleOpioid", [
      "מתחיל עיסויים", "מחבר מוניטור", "בודק דופק", "מנשים במפוח", "פותח IO", "אדרנלין 1 מג IO", "בודק אישונים", "נרקן 2 מג IO", "החייאה",
    ]);
    expect(sim.state).toBe("rosc");
    for (const l of ["בודק דופק", "מלח 250 מל IO", "קפנוגרפיה", "סוכר"]) sim = step(content, sim, l).sim;
    expect(sim.state).toBe("roscStable");
    expect(errors(sim)).toEqual([]);
    expect(missed(sim)).toEqual([]);
  });

  it("child drowning with a slow pulse: ventilate first, compressions under 60, warm", () => {
    const sim = play("pedsDrowning/pulse", ["פותח נתיב אוויר ושואב", "מנשים במפוח", "בודק דופק", "מוניטור", "מסיר בגדים רטובים ומחמם", "ממתין", "בודק דופק", "מפנה"]);
    expect(sim.state).toBe("breathing");
    expect(errors(sim)).toEqual([]);
    expect(missed(sim)).toEqual([]);
  });

  it("child drowning in arrest: ventilation first, CPR, IO, adrenaline per kg, warming", () => {
    let sim = play("pedsDrowning/arrest", [
      "מנשים במפוח", "מתחיל עיסויים", "מחבר מוניטור", "פותח IO", "אדרנלין {w100} מג IO", "מסיר בגדים רטובים ומחמם", "החייאה",
    ]);
    expect(sim.state).toBe("rosc");
    for (const l of ["בודק דופק", "סוכר", "מפנה"]) sim = step(content, sim, l).sim;
    expect(errors(sim)).toEqual([]);
    expect(missed(sim)).toEqual([]);
  });

  it("child hit by a car: spine, oxygen, GCS, 20 ml/kg, TXA 15 mg/kg, fast transport", () => {
    const sim = play("pedsTrauma/", [
      "בודק זירה", "קיבוע ידני של הצוואר", "חמצן", "GCS ואישונים", "לחץ דם", "מילוי קפילרי", "בודק בטן", "פותח IO",
      "סליין {w20} מל IO", "הקסקפרון {w15} מג IO", "סד לירך", "מכסה בשמיכה", "מפנה", "דיווח מקדים",
    ]);
    expect(sim.state).toBe("better");
    expect(errors(sim)).toEqual([]);
    expect(missed(sim)).toEqual([]);
  });
});
