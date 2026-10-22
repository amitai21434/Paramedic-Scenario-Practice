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

/** Typos no reader could safely guess ("נציב", "וואיד", "אדן", cut-off words, two words run together), a dose said
 *  again after it was already given, and remarks that aren't orders ("מה לעשות", "למחוק"). */
const UNGUESSABLE = [
  "נציב אוויר", "וואיד", "בדיקת אדן", "‏אישוניםסוכר", "100 מ״ג",
  "‏מחל", "‏בטי", "ת", "סיו", "שתתן", "שויפה", "שאיבת תאופו", "צוות ננוסףוריד", "נדעמות", "לחיצות חז", "יןפי", "גוף זריצ?", "Pra",
  "חדד לאסטמה בינונית", "האם צרד", "האם המשפחה רוצה הלוואה",
  "6 מ״ג", "1 ג", "0.5 מג", "0.5", "מג",
  "מונשמת", "מה לעשות", "למחוק", "חולה", "בדיקות", "אוויר קר", "חשיפה לאוויר קר",
];

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

  // Runs 30–72 (tester B, one started by B and finished by A).
  const did = (sim: Sim, id: string) => sim.actions.some((a) => a.action === id);
  const doses = (sim: Sim, drug: string) => sim.actions.filter((a) => a.drug?.drug === drug).map((a) => a.drug!);

  it("only an end word ends the scenario: 'מסיכת חמצן', 'הנשמה מסייעת' don't", () => {
    for (const n of [32, 36, 51]) expect(run(n).sim.messages.some((m) => "text" in m && m.text === "התרחיש הסתיים." && m.from === "examiner"), `run ${n}`).toBe(false);
  });

  it("'חמצן מסיכה' is a mask, never pulling a baby; 'הערכת מקצב' checks the rhythm, never paces", () => {
    for (const n of [45, 59, 63]) expect(did(run(n).sim, "pullBaby"), `run ${n}`).toBe(false);
    for (const n of [33, 51]) expect(did(run(n).sim, "pacing"), `run ${n}`).toBe(false);
    expect(did(run(33).sim, "rhythmCheck")).toBe(true);
  });

  it("DNR: asking whether they want resuscitation asks about the directive — it doesn't start CPR", () => {
    const r = run(38);
    expect(did(r.sim, "cpr")).toBe(false);
    expect(r.d.checklist.find((c) => c.label.startsWith("בירור קיום הנחיה"))!.doneAt).not.toBeNull();
    expect(run(70).d.checklist.find((c) => c.label === "אישור רופא במוקד הרפואי")!.doneAt).not.toBeNull();
  });

  it("'שוק נוירוגני' is a diagnosis, not a shock; 'כיסוי' covers the patient (not fire services)", () => {
    const r = run(62);
    expect(did(r.sim, "shock")).toBe(false);
    expect(did(r.sim, "callFire")).toBe(false);
    expect(r.d.checklist.find((c) => c.label.startsWith("מניעת היפותרמיה"))!.doneAt).not.toBeNull();
  });

  it("a route said with the drug holds for the dose that follows ('דורמיקום בשריר' → '10 מג')", () => {
    expect(doses(run(41).sim, "midazolam")[0]).toMatchObject({ value: 10, route: "im" });
  });

  it("drugs drawn up are given once, when injected ('שאיבת…' → 'הזרקת תרופות')", () => {
    expect(doses(run(42).sim, "ketamine")).toHaveLength(1);
    expect(doses(run(49).sim, "adrenaline")).toHaveLength(1);
  });

  it("doses written before each drug; saline a drug is diluted in, or a 10 ml flush, isn't a fluid order", () => {
    const r37 = run(37).sim;
    expect(doses(r37, "salbutamol")[0]).toMatchObject({ value: 5, unit: "mg" });
    expect(doses(r37, "ipratropium")[0]).toMatchObject({ value: 0.5, unit: "mg" });
    expect(doses(run(45).sim, "saline")).toEqual([]);
    expect(doses(run(53).sim, "saline").map((g) => g.value)).toEqual([480]);
    expect(doses(run(61).sim, "saline")).toEqual([]);
  });

  it("a language barrier is solved by talking to the daughter, who speaks Hebrew ('בתו מדברת')", () => {
    const r = run(47);
    expect(r.d.checklist.find((c) => c.label.includes("מחסום שפה"))!.doneAt).not.toBeNull();
    expect(r.replies["מה קרה"]).toMatch(/בתו מדברת עברית/);
  });

  it("delirium: the complaint is the patient's own words; asking why they called isn't transport", () => {
    const r = run(30);
    expect(r.replies["מה התלונה שלו"]).toMatch(/^המטופל:/);
    expect(r.replies["אני שואלת המטופל למה הוא הזמין אמבולנס"]).not.toMatch(/🚑/);
  });

  it("a child's VT that turns pulseless stays in VF until shocked; cardioverting sinus tachycardia is an error", () => {
    expect(run(34).sim.state).not.toBe("sinus");
    expect(run(64).d.errors.some((e) => e.text.includes("לקצב סינוס"))).toBe(true);
  });

  it("a drug this storyline doesn't use gets a warning, not a wrong-dose error", () => {
    expect(run(57).d.errors.filter((e) => e.text.startsWith("אדרנלין"))).toEqual([]);
  });

  it("'how do you feel?' after the treatment worked gets an honest answer; weight comes from the parent", () => {
    const { replies } = run(21);
    expect(replies["איך הרגיש"]).toMatch(/יותר טוב/);
    expect(replies["משקל"]).toMatch(/^אמו: .*שוקל בערך \d+ ק"ג/);
  });
});
