// By-the-book play-throughs for the מצחים station: doing it right should
// reach the good state with no errors. Skipped without the content folder.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { startSim, step } from "../engine";
import { generate } from "../generate";
import type { Case, Content, Sim } from "../types";

const root = path.resolve(import.meta.dirname, "../../../..");
const hasContent = fs.existsSync(path.join(root, "content"));
const content: Content = hasContent
  ? JSON.parse(execFileSync(process.execPath, [path.join(root, "reference/content.mjs")], { encoding: "utf8" }))
  : { cases: [], drugs: {}, protocols: {} };

/** First seed whose patient matches (no allergy drug by default). */
function seedWhere(id: string, variant: string | undefined, ok: (c: Case) => boolean = () => true): number {
  const t = content.cases.find((c) => c.id === id)!;
  for (let seed = 1; seed < 5000; seed++) {
    const c = generate(t, seed, variant);
    if (!c.allergyDrug && ok(c)) return seed;
  }
  throw new Error("no seed");
}

function run(id: string, variant: string | undefined, seed: number, lines: string[]): Sim {
  let sim = startSim(content, id, seed, variant);
  for (const line of lines) {
    const r = step(content, sim, line);
    expect(r.understood, `not understood: ${line}`).toBe(true);
    sim = r.sim;
  }
  return sim;
}

const errors = (sim: Sim) => sim.feedback.filter((f) => f.kind === "error").map((f) => f.text);
const waits = (n: number) => Array.from({ length: n }, () => "ממתין");

describe.skipIf(!hasContent)("מצחים — by the book", () => {
  it("severe asthma improves with adrenaline, nebs and magnesium", () => {
    const sim = run("asthma", "severe", seedWhere("asthma", "severe"), [
      "מושיב את המטופל",
      "חמצן, סטורציה ומוניטור",
      "האזנה לריאות",
      "יש אלרגיות?",
      "אדרנלין 0.5 מג IM",
      "ונטולין 5 מג באינהלציה ואירובנט 0.5 מג",
      "פותח וריד",
      "מגנזיום 2 גרם בטפטוף",
      "סולומדרול 125 מג",
    ]);
    expect(sim.state).toBe("better");
    expect(errors(sim)).toEqual([]);
  });

  it("COPD with CO2 narcosis: CPAP is flagged; intubation stabilizes", () => {
    const seed = seedWhere("copd", "narcosis");
    const bad = run("copd", "narcosis", seed, ["CPAP"]);
    expect(errors(bad).join(" ")).toContain("CPAP");
    const good = run("copd", "narcosis", seed, ["הכרה", "קפנוגרפיה", "הנשמה במפוח", "אינטובציה"]);
    expect(good.state).toBe("ventilated");
  });

  it("anaphylactic shock: IM adrenaline and fluids", () => {
    const seed = seedWhere("anaphylaxis", "shock", (c) => c.vars.refractory === 0);
    const sim = run("anaphylaxis", "shock", seed, [
      "לחץ דם והכרה",
      "משכיב ומרים רגליים",
      "אדרנלין 0.5 מג בשריר",
      "וריד",
      "סליין 1000 מל",
    ]);
    expect(sim.state).toBe("better");
    expect(errors(sim)).toEqual([]);
  });

  it("anaphylaxis: 0.5 mg adrenaline IV is a dose error", () => {
    const sim = run("anaphylaxis", "shock", seedWhere("anaphylaxis", "shock"), ["וריד", "אדרנלין 0.5 מג IV"]);
    expect(errors(sim).join(" ")).toContain("מינון שגוי");
  });

  it("choking: cough, then Heimlich clears complete obstruction; back blows are wrong", () => {
    const seed = seedWhere("choking", "partial", (c) => c.vars.coughWorks === 0 && c.vars.thrusts === 1);
    const sim = run("choking", "partial", seed, ["עידוד שיעול", ...waits(3), "היימליך"]);
    expect(sim.state).toBe("cleared");
    const bad = run("choking", "partial", seed, ["טפיחות גב"]);
    expect(errors(bad).join(" ")).toContain("טפיחות");
  });

  it("hypoglycemia wakes up after IV glucose", () => {
    const sim = run("loc", "hypo", seedWhere("loc", "hypo"), ["הכרה", "בדיקת סוכר", "פותח וריד", "גלוקוז 25 גרם", "סוכר חוזר"]);
    expect(sim.state).toBe("awake");
    expect(errors(sim)).toEqual([]);
  });

  it("opioid overdose: ventilate, then naloxone", () => {
    const sim = run("loc", "opioid", seedWhere("loc", "opioid"), ["נשימה", "הנשמה במפוח", "סוכר", "וריד", "נרקן 0.4 מג IV"]);
    expect(sim.state).toBe("breathing");
    expect(errors(sim)).toEqual([]);
  });

  it("status epilepticus stops with midazolam 10 mg IN (and 10 mg IV is an error)", () => {
    const seed = seedWhere("seizure", undefined);
    const sim = run("seizure", undefined, seed, ["על הצד", "חמצן", "סוכר", "דורמיקום 10 מג באף"]);
    expect(sim.state).toBe("postictal");
    expect(errors(sim)).toEqual([]);
    const bad = run("seizure", undefined, seed, ["וריד", "דורמיקום 10 מג IV"]);
    expect(errors(bad).join(" ")).toContain("מינון שגוי");
  });

  it("stroke mimic: glucose resolves it; stroke center without a glucose check is flagged", () => {
    const seed = seedWhere("stroke", "hypoMimic");
    const sim = run("stroke", "hypoMimic", seed, ["בדיקה נוירולוגית", "סוכר", "וריד", "דקסטרוז 100 מל"]);
    expect(sim.state).toBe("resolved");
    const bad = run("stroke", "hypoMimic", seed, ["מרכז צנתור מוחי"]);
    expect(errors(bad).join(" ")).toContain("היפוגליקמיה");
  });

  it("heat stroke: cool before transport; transporting hot is flagged", () => {
    const seed = seedWhere("heatstroke", undefined, (c) => c.vars.seizes === 0);
    const sim = run("heatstroke", undefined, seed, ["מדידת חום", "קירור", "סוכר", "וריד", "סליין 500", ...waits(10), "חום", "פינוי"]);
    expect(sim.state).toBe("cooled");
    expect(errors(sim)).toEqual([]);
    const bad = run("heatstroke", undefined, seed, ["פינוי"]);
    expect(errors(bad).join(" ")).toContain("39");
  });

  it("organophosphates: decon before IV, doubling atropine dries secretions", () => {
    const seed = seedWhere("organophosphate", undefined, (c) => c.vars.atropineNeeded === 14);
    const sim = run("organophosphate", undefined, seed, [
      "בטיחות זירה ומיגון", "הפשטה וטיהור", "אישונים", "האזנה", "חמצן", "וריד",
      "אטרופין 2 מג", "אטרופין 4 מג", "אטרופין 8 מג", "אירובנט 1 מג באינהלציה",
    ]);
    expect(sim.state).toBe("atropinized");
    expect(errors(sim)).toEqual([]);
  });

  it("eclampsia: magnesium 4 g", () => {
    const sim = run("obstetric", "eclampsia", seedWhere("obstetric", "eclampsia"), ["לחץ דם", "חמצן", "וריד", "מגנזיום 4 גרם בטפטוף", "הטיה לשמאל"]);
    expect(sim.state).toBe("treated");
    expect(errors(sim)).toEqual([]);
  });

  it("postpartum hemorrhage: uterine massage + TXA controls bleeding", () => {
    const sim = run("obstetric", "pph", seedWhere("obstetric", "pph"), ["לחץ דם", "בדיקת דימום וגינלי", "עיסוי רחם", "וריד", "סליין 500", "הקסקפרון 1 גרם"]);
    expect(sim.state).toBe("controlled");
    expect(errors(sim)).toEqual([]);
  });

  it("delivery with nuchal cord: check the cord after the head is out", () => {
    const seed = seedWhere("obstetric", "delivery", (c) => c.vars.complication === 1);
    const sim = run("obstetric", "delivery", seed, ["בדיקת נרתיק", "היערכות ללידה", "קבלת לידה", "בדיקת חבל טבור", "ייבוש ועטיפה", "אפגר"]);
    expect(sim.state).toBe("born");
  });
});
