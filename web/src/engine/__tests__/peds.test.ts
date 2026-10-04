// By-the-book play-throughs for the ילדים station. Doses are computed from
// the generated child's weight, as a student would with a Broselow tape.

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

function caseFor(id: string, variant: string | undefined, ok: (c: Case) => boolean = () => true) {
  const t = content.cases.find((c) => c.id === id)!;
  for (let seed = 1; seed < 5000; seed++) {
    const c = generate(t, seed, variant);
    if (!c.allergyDrug && ok(c)) return { seed, w: c.weight };
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
const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

describe.skipIf(!hasContent)("ילדים — by the book", () => {
  it("severe pediatric asthma: weight-based nebs, steroid and IM adrenaline", () => {
    const { seed, w } = caseFor("pedsAsthma", "severe");
    const sim = run("pedsAsthma", "severe", seed, [
      "מושיב וחמצן", "סטורציה והאזנה",
      `ונטולין ${r1(0.15 * w)} מג באינהלציה ואירובנט ${w < 20 ? 0.25 : 0.5} מג`,
      "וריד", `סולומדרול ${Math.round(2 * w)} מג`,
      `אדרנלין ${r2(Math.min(0.01 * w, 0.4))} מג IM`,
    ]);
    expect(sim.state).toBe("better");
    expect(errors(sim)).toEqual([]);
  });

  it("croup: nebulized adrenaline; laying the child down is wrong", () => {
    const { seed, w } = caseFor("stridor", "croup");
    const sim = run("stridor", "croup", seed, ["סטורציה ונתיב אוויר", `אדרנלין ${r1(Math.min(0.5 * w, 5))} מג באינהלציה`]);
    expect(sim.state).toBe("better");
    expect(errors(sim)).toEqual([]);
    expect(errors(run("stridor", "croup", seed, ["משכיב"])).join(" ")).toContain("סטרידור");
  });

  it("pediatric anaphylaxis: 0.01 mg/kg IM and 20 ml/kg", () => {
    const { seed, w } = caseFor("pedsAnaphylaxis", "refractory", (c) => c.vars.responds === 1);
    const sim = run("pedsAnaphylaxis", "refractory", seed, [
      "לחץ דם ועור", `אדרנלין ${r2(Math.min(0.01 * w, 0.5))} מג בשריר`, "IO", `סליין ${Math.round(20 * w)} מל`,
    ]);
    expect(sim.state).toBe("better");
    expect(errors(sim)).toEqual([]);
  });

  it("an adult adrenaline dose for a child is a dose error", () => {
    const { seed } = caseFor("pedsAnaphylaxis", "refractory");
    expect(errors(run("pedsAnaphylaxis", "refractory", seed, ["אדרנלין 0.5 מג IM"])).join(" ")).toContain("מינון שגוי");
  });

  it("febrile status epilepticus: midazolam 0.2 mg/kg IN", () => {
    const { seed, w } = caseFor("pedsSeizure", "status");
    const sim = run("pedsSeizure", "status", seed, ["על הצד", "חמצן", "סוכר", `דורמיקום ${r1(0.2 * w)} מג באף`]);
    expect(sim.state).toBe("postictal");
    expect(errors(sim)).toEqual([]);
  });

  it("hypoglycemic seizure: dextrose 10% in ml/kg counts as g/kg", () => {
    const { seed, w } = caseFor("pedsSeizure", "hypo");
    const sim = run("pedsSeizure", "hypo", seed, ["סוכר", "וריד", `דקסטרוז ${Math.round(3 * w)} מל`]);
    expect(sim.state).toBe("awake");
    expect(errors(sim)).toEqual([]);
  });

  it("toddler opioid ingestion: ventilate, naloxone 0.1 mg/kg", () => {
    const { seed, w } = caseFor("pedsOpioid", undefined);
    const sim = run("pedsOpioid", undefined, seed, ["נשימה", "הנשמה במפוח", "סוכר", "מה קרה?", "IO", `נרקן ${r1(0.1 * w)} מג IO`]);
    expect(sim.state).toBe("breathing");
    expect(errors(sim)).toEqual([]);
  });

  it("dehydration: two 20 ml/kg boluses; adenosine is wrong", () => {
    const { seed, w } = caseFor("dehydration", undefined);
    const bolus = `סליין ${Math.round(20 * w)} מל`;
    const sim = run("dehydration", undefined, seed, ["מילוי קפילרי ודופק", "סוכר", "IO", bolus, "דופק", bolus]);
    expect(sim.state).toBe("better");
    expect(errors(sim)).toEqual([]);
    expect(errors(run("dehydration", undefined, seed, ["IO", "אדנוזין 1 מג"])).join(" ")).toContain("אדנוזין");
  });

  it("infant PSVT: vagal fails, adenosine 0.1 then 0.2 mg/kg converts", () => {
    const { seed, w } = caseFor("pedsTachy", "psvtInfant", (c) => c.vars.vagalWorks === 0 && c.vars.adenosineNeeded > 0.2);
    const sim = run("pedsTachy", "psvtInfant", seed, [
      "מוניטור", "מילוי קפילרי", "אקג 12", "שקית קרח על הפנים", "IO",
      `אדנוזין ${r2(0.1 * w)} מג`, `אדנוזין ${r2(0.2 * w)} מג`,
    ]);
    expect(sim.state).toBe("sinus");
    expect(errors(sim)).toEqual([]);
  });

  it("unstable PSVT with fever: sedation and sync 0.5–1 J/kg", () => {
    const { seed, w } = caseFor("pedsTachy", "psvtUnstableFever");
    const sim = run("pedsTachy", "psvtUnstableFever", seed, ["לחץ דם והכרה", "מוניטור", "IO", `דורמיקום ${r1(0.1 * w)} מג`, `היפוך מסונכרן ${Math.round(w)} גאול`]);
    expect(sim.state).toBe("sinus");
    expect(errors(sim)).toEqual([]);
  });

  it("hypoxic bradycardia in an infant responds to ventilation", () => {
    const { seed } = caseFor("pedsBrady", undefined);
    const sim = run("pedsBrady", undefined, seed, ["נשימה ודופק", "הנשמה במפוח", "ממתין"]);
    expect(sim.state).toBe("oxygenated");
  });

  it("pediatric VF: 2 J/kg, then 4 J/kg, adrenaline and amiodarone per kg → ROSC", () => {
    const { seed, w } = caseFor("pedsVf", undefined);
    let sim = run("pedsVf", undefined, seed, [
      "עיסויים", "מוניטור", `שוק ${Math.round(2 * w)}`, "החייאה ו-IO", `שוק ${Math.round(4 * w)}`,
      `אדרנלין ${r2(0.01 * w)} מג`, "החייאה, הנשמה במפוח", `שוק ${Math.round(4 * w)}`, `אמיודרון ${Math.round(5 * w)} מג`, "החייאה",
    ]);
    for (let i = 0; i < 3 && sim.state === "vf"; i++) {
      sim = step(content, sim, `שוק ${Math.round(4 * w)}`).sim;
      sim = step(content, sim, "החייאה").sim;
    }
    expect(sim.state).toBe("rosc");
    expect(errors(sim)).toEqual([]);
  });

  it("newborn apnea: dry, stimulate, ventilate → pink and crying", () => {
    const { seed } = caseFor("newborn", "apnea");
    const sim = run("newborn", "apnea", seed, ["ייבוש ועטיפה", "גירוי", "הנשמה במפוח", "ממתין"]);
    expect(sim.state).toBe("pink");
    expect(errors(sim)).toEqual([]);
  });

  it("newborn needing CPR: compressions with a pulse under 60 are correct", () => {
    const { seed, w } = caseFor("newborn", "cpr");
    const sim = run("newborn", "cpr", seed, ["ייבוש ועטיפה וגירוי", "הנשמה במפוח", "מוניטור", "עיסויים", "IO", `אדרנלין ${r2(0.02 * w)} מג`]);
    expect(sim.state).toBe("pink");
    expect(errors(sim)).toEqual([]);
  });

  it("infant choking: back blows and chest thrusts; abdominal thrusts are wrong", () => {
    const { seed } = caseFor("infantChoking", undefined, (c) => c.vars.cycles === 1);
    const sim = run("infantChoking", undefined, seed, ["נתיב אוויר", "5 טפיחות גב", "5 לחיצות חזה"]);
    expect(sim.state).toBe("cleared");
    expect(errors(run("infantChoking", undefined, seed, ["היימליך"])).join(" ")).toContain("לחיצות");
  });
});
