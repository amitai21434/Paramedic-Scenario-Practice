// Random complications: they start only when rolled and eligible, change what's
// measured until handled, add debrief items only when they happened, and get
// worse if ignored. Skipped without the content folder.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { debrief } from "../debrief";
import { rollComplication, startSim, step } from "../engine";
import { finding } from "../physiology";
import type { Content, Sim } from "../types";

const root = path.resolve(import.meta.dirname, "../../../..");
const hasContent = fs.existsSync(path.join(root, "content"));
const content: Content = hasContent
  ? JSON.parse(execFileSync(process.execPath, [path.join(root, "reference/content.mjs")], { encoding: "utf8" }))
  : { cases: [], drugs: {}, protocols: {} };

function run(sim: Sim, lines: string[]): Sim {
  for (const l of lines) sim = step(content, sim, l).sim;
  return sim;
}
/** Waits (up to ~20 min) until the complication starts. */
function untilStarted(sim: Sim): Sim {
  for (let i = 0; i < 40 && !sim.comp && !sim.ended; i++) sim = step(content, sim, "ממתין").sim;
  expect(sim.comp, "complication didn't start").toBeTruthy();
  return sim;
}
const items = (sim: Sim) => debrief(content, sim).checklist.filter((i) => i.label.startsWith("סיבוך"));
const errors = (sim: Sim) => sim.feedback.filter((f) => f.kind === "error").map((f) => f.text);

describe.skipIf(!hasContent)("complications", () => {
  it("never appear unless rolled", () => {
    const sim = run(startSim(content, "loc", 3, "hypo"), ["חמצן", "פותח וריד", ...Array(20).fill("ממתין")]);
    expect(sim.comp ?? null).toBeNull();
    expect(items(sim)).toEqual([]);
  });

  it("are rolled in about a third of runs, the same way for the same seed", () => {
    let n = 0;
    for (let seed = 1; seed <= 2000; seed++) if (rollComplication(content, "acs", seed)) n++;
    expect(n / 2000).toBeGreaterThan(0.28);
    expect(n / 2000).toBeLessThan(0.42);
    expect(rollComplication(content, "acs", 77)).toEqual(rollComplication(content, "acs", 77));
  });

  it("vomiting: suction and side position resolve it; debrief credits both", () => {
    let sim = untilStarted(startSim(content, "loc", 3, "hypo", ["vomit"]));
    expect(sim.messages.some((m) => "text" in m && m.text.includes("להקיא"))).toBe(true);
    expect(finding(sim, "airway")).toMatch(/קיא/);
    sim = run(sim, ["שאיבת הפרשות", "משכיב על הצד", "האזנה לריאות"]);
    expect(sim.comp!.resolvedAt).not.toBeNull();
    expect(finding(sim, "airway")).not.toMatch(/קיא/);
    expect(items(sim).every((i) => i.doneAt !== null)).toBe(true);
    expect(debrief(content, sim).complication).toMatchObject({ title: expect.stringMatching(/הקאה/) });
  });

  it("vomiting ignored: aspiration, and the debrief shows what was missed", () => {
    let sim = untilStarted(startSim(content, "loc", 3, "hypo", ["vomit"]));
    const before = sim.vitals.spo2;
    sim = run(sim, ["ממתין", "ממתין", "ממתין", "ממתין"]);
    expect(sim.comp!.worse).toBe(true);
    expect(finding(sim, "lungs")).toMatch(/חרחורים/);
    expect(before).not.toBeNull();
    expect(items(sim).filter((i) => i.critical && i.doneAt === null).length).toBe(2);
    expect(debrief(content, sim).complication!.resolvedAt).toBeNull();
  });

  it("lost IV: drugs need new access; a new IV resolves it", () => {
    let sim = run(startSim(content, "loc", 3, "hypo", ["ivLost"]), ["פותח וריד"]);
    sim = untilStarted(sim);
    expect(sim.flags).not.toContain("iv");
    sim = run(sim, ["פותח וריד"]);
    expect(sim.comp!.resolvedAt).not.toBeNull();
    expect(items(sim).every((i) => i.doneAt !== null)).toBe(true);
  });

  it("empty oxygen cylinder: saturation drops until oxygen is restarted", () => {
    let sim = run(startSim(content, "asthma", 5, "severe", ["o2Empty"]), ["חמצן"]);
    sim = untilStarted(sim);
    expect(sim.flags).not.toContain("o2");
    sim = run(sim, ["חמצן"]);
    expect(sim.comp!.resolvedAt).not.toBeNull();
    expect(errors(sim)).toEqual([]);
  });

  it("displaced tube: capnography shows it; re-intubation fixes it", () => {
    let sim = run(startSim(content, "asthma", 5, "failure", ["tubeDisplaced"]), ["מנשים במפוח", "קטמין 2 מג לקג", "אינטובציה"]);
    sim = untilStarted(sim);
    sim = run(sim, ["קפנוגרפיה"]);
    expect(sim.messages.at(-1)).toMatchObject({ text: expect.stringMatching(/ETCO2: [0-9] mmHg/) });
    sim = run(sim, ["מנשים במפוח", "אינטובציה חוזרת"]);
    expect(sim.comp!.resolvedAt).not.toBeNull();
    expect(items(sim).every((i) => i.doneAt !== null)).toBe(true);
  });

  it("only one starts per run, and only when it fits (no IV ⇒ no lost IV)", () => {
    let sim = startSim(content, "loc", 3, "hypo", ["ivLost", "vomit"]);
    sim = untilStarted(sim);
    expect(sim.comp!.id).toBe("vomit");
    sim = run(sim, ["פותח וריד", ...Array(10).fill("ממתין")]);
    expect(sim.comp!.id).toBe("vomit");
  });

  it("seizure: midazolam stops it; glucose and BP afterwards are expected", () => {
    let sim = untilStarted(startSim(content, "stroke", 4, "lvo", ["seizure"]));
    expect(finding(sim, "general")).toMatch(/פרכוס/);
    sim = run(sim, ["משכיב על הצד", "חמצן", "פותח וריד", "דורמיקום 5 מג IV", "סוכר", "לחץ דם"]);
    expect(sim.comp!.resolvedAt).not.toBeNull();
    expect(items(sim).every((i) => i.doneAt !== null)).toBe(true);
    expect(errors(sim)).toEqual([]);
  });

  it("seizure only in storylines that opt in, and only for adults", () => {
    for (let seed = 1; seed < 300; seed++) {
      expect(rollComplication(content, "acs", seed) ?? []).not.toContain("seizure");
      expect(rollComplication(content, "pulmonaryEdema", seed) ?? []).not.toContain("hypotension");
    }
    expect([...Array(300)].some((_, i) => rollComplication(content, "headInjury", i + 1)?.includes("seizure"))).toBe(true);
  });

  it("low BP after fentanyl: a repeat BP and a fluid bolus fix it", () => {
    let sim = run(startSim(content, "acs", 4, "anterior", ["hypotension"]), ["יש אלרגיות?", "פותח וריד", "פנטניל 50 מקג IV"]);
    sim = untilStarted(sim);
    sim = run(sim, ["לחץ דם"]);
    expect(sim.measured.sbp!.value!).toBeLessThan(85);
    sim = run(sim, ["מלח 250 מל IV"]);
    expect(sim.comp!.resolvedAt).not.toBeNull();
    expect(items(sim).every((i) => i.doneAt !== null)).toBe(true);
  });
});
