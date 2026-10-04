// By-the-book play-throughs for the טראומה station.

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

describe.skipIf(!hasContent)("טראומה — by the book", () => {
  it("tension pneumothorax: needle decompression relieves it", () => {
    const { seed } = caseFor("chestTrauma", "tension", (c) => c.vars.needles === 1);
    const sim = run("chestTrauma", "tension", seed, ["בטיחות זירה", "קיבוע צוואר", "נתיב אוויר, האזנה ודופק", "חמצן", "בדיקת צוואר", "ניקור חזה"]);
    expect(sim.state).toBe("relieved");
    expect(errors(sim)).toEqual([]);
  });

  it("stab wound: chest seal, then needle when tension develops", () => {
    const { seed } = caseFor("chestTrauma", "stab");
    let sim = run("chestTrauma", "stab", seed, ["בטיחות", "האזנה ודופק", "בדיקת בית חזה", "חבישת אשרמן", "חמצן", "וריד", "ממתין", "ממתין", "ממתין"]);
    expect(sim.state).toBe("tension");
    sim = step(content, sim, "נידל").sim;
    expect(sim.state).toBe("relieved");
  });

  it("limb hemorrhage: tourniquet first, TXA", () => {
    const { seed } = caseFor("hemorrhage", "limb");
    const sim = run("hemorrhage", "limb", seed, ["חוסם עורקים", "נתיב אוויר ודופק", "וריד", "הקסקפרון 1 גרם", "שמיכה", "פינוי"]);
    expect(sim.state).toBe("controlled");
    expect(errors(sim)).toEqual([]);
  });

  it("abdominal gunshot: plasma restores a radial pulse", () => {
    const { seed } = caseFor("hemorrhage", "abdomen");
    const sim = run("hemorrhage", "abdomen", seed, ["בטיחות", "נתיב אוויר ודופק", "בטן וגב", "פינוי דחוף", "וריד", "הקסקפרון 1 גרם", "פלזמה 1 מנה"]);
    expect(sim.state).toBe("radial");
    expect(errors(sim)).toEqual([]);
  });

  it("pelvic fracture: binder plus a 250 ml bolus", () => {
    const { seed } = caseFor("hemorrhage", "pelvis");
    const sim = run("hemorrhage", "pelvis", seed, ["קיבוע צוואר", "בדיקת אגן", "מקבע אגן", "וריד", "הקסקפרון 1 גרם", "סליין 250"]);
    expect(sim.state).toBe("radial");
    expect(errors(sim)).toEqual([]);
  });

  it("severe head injury: ventilate and intubate", () => {
    const { seed } = caseFor("headInjury", "severe");
    const sim = run("headInjury", "severe", seed, ["קיבוע צוואר", "GCS ואישונים", "הנשמה במפוח", "וריד", "קטמין 2 מג לקג", "אינטובציה", "קפנוגרפיה"]);
    expect(sim.state).toBe("secured");
    expect(errors(sim)).toEqual([]);
  });

  it("smoke inhalation: cyanokit and early intubation", () => {
    const { seed } = caseFor("burns", "smoke");
    const sim = run("burns", "smoke", seed, ["חמצן", "נתיב אוויר", "וריד", "ציאנוקיט 5 גרם בטפטוף", "אינטובציה"]);
    expect(sim.state).toBe("antidote");
    expect(errors(sim)).toEqual([]);
  });

  it("30% burns: dressing, 20 ml/kg, analgesia; cooling a large burn is wrong", () => {
    const { seed, w } = caseFor("burns", "burns30");
    const sim = run("burns", "burns30", seed, [
      "נתיב אוויר", "הפשטה", "היקף הכוויות", "חבישת כוויות", "שמיכה", "וריד",
      `סליין ${Math.round(20 * w)} מל`, "אלרגיות?", `פנטניל ${Math.round(1 * w)} מקג`,
    ]);
    expect(errors(sim)).toEqual([]);
    expect(errors(run("burns", "burns30", seed, ["קירור"])).join(" ")).toContain("10%");
  });

  it("traumatic arrest: bilateral needle decompression gets a pulse back", () => {
    const { seed } = caseFor("tcpa", "tension");
    const sim = run("tcpa", "tension", seed, ["הנשמה במפוח", "מוניטור", "אישונים", "ניקור חזה", "ניקור חזה בצד השני"]);
    expect(sim.state).toBe("rosc");
  });

  it("isolated fracture: analgesia after asking about allergies, then splint", () => {
    const { seed, w } = caseFor("fracture", undefined);
    const sim = run("fracture", undefined, seed, ["בדיקת גפיים", "רמת כאב", "אלרגיות?", "וריד", `פנטניל ${Math.round(1.5 * w)} מקג`, "סד", "בדיקת גפיים"]);
    expect(sim.state).toBe("relieved");
    expect(errors(sim)).toEqual([]);
  });
});
