// Replays of real runs by testers (fixtures/real-runs.json — tester A writes long narrative messages,
// tester B short keywords). Every message must be understood except a few typos no reader could
// guess, and the moments that went wrong live must now go right.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { debrief } from "../debrief";
import { startSim, step } from "../engine";
import type { Content, Sim } from "../types";

const root = path.resolve(import.meta.dirname, "../../../..");
const hasContent = fs.existsSync(path.join(root, "content"));
const content: Content = hasContent
  ? JSON.parse(execFileSync(process.execPath, [path.join(root, "reference/content.mjs")], { encoding: "utf8" }))
  : { cases: [], drugs: {}, protocols: {} };

type RealRun = { run: number; tester: string; id: string; variant: string | null; seed: number; complications: string[] | null; lines: string[] };
const RUNS: RealRun[] = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "fixtures/real-runs.json"), "utf8"));

/** Typos no reader could safely guess ("נציב", "וואיד", "אדן", two words run together) and a repeated dose. */
const UNGUESSABLE = ["נציב אוויר", "וואיד", "בדיקת אדן", "‏אישוניםסוכר", "100 מ״ג"];

function replay(r: RealRun) {
  let sim: Sim = startSim(content, r.id, r.seed, r.variant ?? undefined, r.complications ?? undefined);
  const notUnderstood: string[] = [];
  const replies: Record<string, string> = {};
  for (const line of r.lines) {
    const res = step(content, sim, line);
    if (!res.understood) notUnderstood.push(line);
    sim = res.sim;
    const i = sim.messages.map((m) => m.from).lastIndexOf("user");
    replies[line] = sim.messages.slice(i + 1).map((m) => ("text" in m ? m.text : "ECG")).join(" | ");
  }
  return { sim, notUnderstood, replies, d: debrief(content, sim) };
}

const run = (n: number) => replay(RUNS.find((r) => r.run === n)!);

describe.skipIf(!hasContent)("real runs", () => {
  for (const r of RUNS) {
    it(`run ${r.run} (${r.id}/${r.variant ?? "-"}): every message understood`, () => {
      expect(replay(r).notUnderstood.filter((l) => !UNGUESSABLE.includes(l))).toEqual([]);
    });
  }

  it("newborn: defibrillation pads connect the monitor — they never shock", () => {
    const { sim } = run(26);
    expect(sim.actions.some((a) => a.action === "shock")).toBe(false);
  });

  it("a pending dose survives a question in between (furosemide → weight → 1 mg/kg)", () => {
    const { sim, replies } = run(22);
    expect(replies["משקל"]).toMatch(/ק"ג/);
    expect(sim.actions.some((a) => a.drug?.drug === "furosemide" && a.drug.unit === "mg/kg")).toBe(true);
    // contraindications checked, then a bare dose gives the nitro
    expect(replies["קונטרה אינדיקציות לניטרט"]).toMatch(/לחץ דם/);
    expect(sim.actions.some((a) => a.drug?.drug === "nitro" && a.drug.value === 0.4)).toBe(true);
    // naming the diagnosis or rhythm is recorded, not examined
    expect(replies["בצקת ריאות"]).toBe("📝 נרשם.");
  });

  it("fracture: splinting is understood; 15 mg/kg acetaminophen is a correct dose", () => {
    const { d } = run(23);
    expect(d.checklist.find((c) => c.label === "קיבוע הגפה")!.doneAt).not.toBeNull();
    expect(d.errors.filter((e) => e.text.includes("אקמול"))).toEqual([]);
  });

  it("pelvis: no catastrophic bleed to stop is said so; pain gets a real answer; a range isn't a dose", () => {
    expect(run(20).replies["עצירת דימום פורץ"]).toBe("אין דימום פורץ חיצוני לעצור.");
    const r24 = run(24);
    expect(r24.replies["כאב"]).toMatch(/מתוך 10/);
    expect(r24.replies["1-2 מ״ג לק״ג"]).toMatch(/מינון בדיוק/);
  });

  it("heatstroke: asking about ambulance access isn't leaving; 'דורמיקום 5 מג וריד' gives the 5 mg", () => {
    const r25 = run(25);
    expect(r25.replies["גישה לאמבולנס"]).toMatch(/גישה/);
    expect(r25.d.errors.filter((e) => e.text.startsWith("פינוי"))).toEqual([]);
    const r28 = run(28);
    expect(r28.sim.actions.some((a) => a.drug?.drug === "midazolam" && a.drug.value === 5)).toBe(true);
  });

  it("'how do you feel?' after the treatment worked gets an honest answer; weight comes from the parent", () => {
    const { replies } = run(21);
    expect(replies["איך הרגיש"]).toMatch(/יותר טוב/);
    expect(replies["משקל"]).toMatch(/^אמו: .*שוקל בערך \d+ ק"ג/);
  });
});
