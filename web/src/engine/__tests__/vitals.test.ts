// The debrief's vitals chart shows what the monitor showed: live HR once the monitor is on (not during
// CPR or without a pulse), SpO2 once the probe is on, BP only when taken; drugs and procedures marked.

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

const run = (sim: Sim, lines: string[]) => lines.reduce((s, l) => step(content, s, l).sim, sim);

describe.skipIf(!hasContent)("vitals chart", () => {
  it("logs nothing until something is connected or measured", () => {
    const sim = run(startSim(content, "bradycardia", 1, "atropine"), ["בטיחות זירה", "מה קרה?"]);
    expect(debrief(content, sim).vitals.trend).toEqual([]);
  });

  it("HR from the monitor, BP only when taken, SpO2 with the probe; atropine is marked and the HR rises", () => {
    const sim = run(startSim(content, "bradycardia", 1, "atropine"), ["מוניטור", "לחץ דם", "סטורציה", "פותח וריד", "יש אלרגיות?", "אטרופין 1 מג IV", "לחץ דם", "סיום"]);
    const { trend, events, end } = debrief(content, sim).vitals;
    const hr = trend.filter((p) => p.k === "hr");
    const sbp = trend.filter((p) => p.k === "sbp");
    const dbp = trend.filter((p) => p.k === "dbp");
    expect(hr.length).toBeGreaterThan(4); // every turn while the monitor is on
    expect(sbp.length).toBe(2); // only the two BPs taken
    expect(dbp.map((p) => p.t)).toEqual(sbp.map((p) => p.t)); // each BP is a systolic/diastolic pair
    expect(trend.filter((p) => p.k === "spo2").length).toBeGreaterThan(0);
    const atropine = events.find((e) => e.label === "אטרופין")!;
    expect(atropine).toBeTruthy();
    const before = hr.filter((p) => p.t <= atropine.t).at(-1)!.v;
    const after = hr.at(-1)!.v;
    expect(after).toBeGreaterThan(before + 15);
    expect(end).toBe(sim.ended!.t);
  });

  it("no HR while pulseless or during CPR; a run of CPR cycles is one marker; the shock is marked", () => {
    const sim = run(startSim(content, "arrest", 3, "vf"), ["מתחיל עיסויים", "מחבר מוניטור", "שוק 200", "עיסויים", "עיסויים", "שוק 200", "עיסויים"]);
    const { trend, events } = debrief(content, sim).vitals;
    expect(trend.filter((p) => p.k === "hr")).toEqual([]);
    expect(events.filter((e) => e.label === "עיסויים").length).toBeLessThanOrEqual(3);
    expect(events.filter((e) => e.label === "⚡ שוק").length).toBe(2);
  });

  it("is saved with full transcripts, so the admin view can draw it", async () => {
    const { buildTranscript } = await import("../../lib/history");
    const sim = run(startSim(content, "bradycardia", 1, "atropine"), ["מוניטור", "לחץ דם", "סיום"]);
    expect(buildTranscript(sim).vitals?.trend.length).toBeGreaterThan(0);
  });
});
