// Plays scenarios from the private content folder. Skipped when content/
// isn't present (it's git-ignored).

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { debrief } from "../debrief";
import { startSim, step } from "../engine";
import { generate } from "../generate";
import { ACTIONS, DRUGS } from "../lexicon";
import { effectiveVitals, hasPulse, current } from "../physiology";
import type { Content, Sim } from "../types";
import { validate } from "../validate";

const root = path.resolve(import.meta.dirname, "../../../..");
const hasContent = fs.existsSync(path.join(root, "content"));
const content: Content = hasContent
  ? JSON.parse(execFileSync(process.execPath, [path.join(root, "reference/content.mjs")], { encoding: "utf8" }))
  : { cases: [], drugs: {}, protocols: {} };

/** A seed for this variant whose patient has no allergies or special facts (so a by-the-book run has no errors). */
function plainSeed(templateId: string, variantId: string, sex?: "m" | "f"): number {
  const t = content.cases.find((c) => c.id === templateId)!;
  for (let seed = 1; seed < 5000; seed++) {
    const c = generate(t, seed, variantId);
    if (!c.allergyDrug && c.facts.filter((f) => !f.startsWith("opening")).length === (t.variants?.find((v) => v.id === variantId)?.patient?.facts?.rvInfarct ? 1 : 0) && (!sex || c.sex === sex)) return seed;
  }
  throw new Error("no plain seed");
}

function play(templateId: string, variantId: string | undefined, seed: number, lines: string[]) {
  let sim = startSim(content, templateId, seed, variantId);
  for (const line of lines) {
    const r = step(content, sim, line);
    expect(r.understood, `not understood: ${line}`).toBe(true);
    sim = r.sim;
  }
  return sim;
}

const errors = (sim: Sim) => sim.feedback.filter((f) => f.kind === "error").map((f) => f.text);

describe.skipIf(!hasContent)("scenario content", () => {
  it("passes validation", () => {
    expect(validate(content)).toEqual([]);
  });

  it("ACS anterior: by-the-book run has no errors and a full checklist", () => {
    const seed = plainSeed("acs", "anterior", "m");
    const sim = play("acs", "anterior", seed, [
      "מחבר מוניטור, מודד לחץ דם וסטורציה",
      "חמצן במשקפיים",
      "אקג 12",
      "יש לך אלרגיות?",
      "לקחת ויאגרה?",
      "אספירין 300 מג בלעיסה",
      "פותח וריד",
      "ניטרו 0.4 מג מתחת ללשון",
      "דיווח לקרדיולוג תורן ולחדר צנתורים",
      "פינוי דחוף",
      "סיום",
    ]);
    expect(errors(sim)).toEqual([]);
    const d = debrief(content, sim);
    expect(d.checklist.filter((i) => i.doneAt === null).map((i) => i.label)).toEqual([]);
    expect(sim.ended?.how).toBe("transport");
  });

  it("ACS inferior + RV: nitro is flagged and drops the pressure", () => {
    const seed = plainSeed("acs", "inferiorRv");
    const sim = play("acs", "inferiorRv", seed, ["מוניטור", "ניטרו 0.4"]);
    expect(sim.state).toBe("hypo");
    expect(errors(sim).join(" ")).toContain("אוטם ימני");
  });

  it("ACS heart block: pacing without sedation is an error; with ketamine it isn't", () => {
    const seed = plainSeed("acs", "chb");
    const bad = play("acs", "chb", seed, ["מוניטור", "קיצוב"]);
    expect(bad.state).toBe("paced");
    expect(errors(bad).join(" ")).toContain("סדציה");
    const good = play("acs", "chb", seed, ["מוניטור", "וריד", "קטמין 0.5 מג/קג", "קיצוב"]);
    expect(errors(good)).toEqual([]);
    expect(good.state).toBe("paced");
  });

  it("VF arrest: shocks, adrenaline after the 2nd shock, amiodarone after the 3rd → ROSC", () => {
    const seed = plainSeed("arrest", "vf");
    let sim = play("arrest", "vf", seed, [
      "מתחיל עיסויים",
      "מחבר מוניטור",
      "בדיקת קצב",
      "שוק 200",
      "החייאה, פותח IO",
      "שוק 300",
      "אדרנלין 1 מג IO",
      "החייאה",
      "שוק 360",
      "אמיודרון 300 מג",
      "החייאה",
    ]);
    for (let i = 0; i < 4 && sim.state === "vf"; i++) {
      sim = step(content, sim, "שוק 360").sim;
      sim = step(content, sim, "החייאה").sim;
    }
    expect(sim.state).toBe("rosc");
    sim = step(content, sim, "בודק דופק").sim;
    expect(sim.flags).not.toContain("cpr");
    sim = step(content, sim, "לחץ דם").sim;
    expect(sim.messages.at(-1)).toMatchObject({ text: expect.stringMatching(/לחץ דם: \d+\/\d+/) });
    expect(errors(sim)).toEqual([]);
  });

  it("diagnosis: credited when stated, never an error, mismatches listed", () => {
    const seed = plainSeed("acs", "inferiorRv");
    const sim = play("acs", "inferiorRv", seed, [
      "מוניטור",
      "הקצב הוא סינוס",
      "חושדת ב-STEMI תחתון, נותנת אספירין 300 מג",
      "אבחנה נוספת: אסתמה",
      "סיום",
    ]);
    const d = debrief(content, sim).diagnosis;
    expect(d.items.map((i) => [i.label, i.statedAt !== null])).toEqual([
      ["אוטם (STEMI)", true],
      ["דופן תחתונה", true],
      ["מעורבות של החדר הימני", false],
    ]);
    expect(d.rhythms).toEqual([{ label: "קצב סינוס", statedAt: expect.any(Number) }]);
    expect(d.unmatched.map((u) => u.text)).toEqual(["אבחנה נוספת: אסתמה"]);
    expect(sim.actions.some((a) => a.drug?.drug === "aspirin")).toBe(true);
    expect(sim.feedback.some((f) => f.text.includes("אבחנה"))).toBe(false);
  });

  it("VF arrest: adrenaline before the second shock is flagged", () => {
    const seed = plainSeed("arrest", "vf");
    const sim = play("arrest", "vf", seed, ["עיסויים", "מוניטור", "IO", "אדרנלין 1 מג"]);
    expect(errors(sim).join(" ")).toContain("שני סבבים");
  });

  it("random play never breaks the physiology (no pulse ⇒ no BP/SpO2)", () => {
    const words = [
      ...ACTIONS.filter((a) => a.id !== "end").map((a) => a.words[0]),
      ...DRUGS.map((d) => `${d.words[0]} 1`),
    ];
    for (const t of content.cases) {
      for (const variantId of t.variants?.length ? t.variants.map((v) => v.id) : [undefined]) {
        for (let seed = 1; seed <= 4; seed++) {
          let sim = play(t.id, variantId, seed, []);
          let r = seed * 9973;
          for (let k = 0; k < 40 && !sim.ended; k++) {
            r = (r * 48271) % 2147483647;
            sim = step(content, sim, words[r % words.length]).sim;
            const vit = effectiveVitals(sim);
            if (!hasPulse(current(sim))) {
              expect(vit.sbp).toBeNull();
              expect(vit.spo2).toBeNull();
              expect(vit.gcs).toBe(3);
            } else {
              expect(vit.sbp, `${t.id}/${variantId} ${sim.state}`).not.toBeNull();
            }
          }
        }
      }
    }
  }, 120_000);
});
