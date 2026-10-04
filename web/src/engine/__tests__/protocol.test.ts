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
    const r = step(content, sim, line.replace("{w2}", String(sim.case.weight * 2)).replace("{w}", String(sim.case.weight)));
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
});
