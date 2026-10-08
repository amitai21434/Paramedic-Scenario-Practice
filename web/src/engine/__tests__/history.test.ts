// What a finished run saves to the history, and the weak-spots summary.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildResult, weakSpots, type ResultRow } from "../../lib/history";
import { startSim, step } from "../engine";
import type { Content, Sim } from "../types";

const root = path.resolve(import.meta.dirname, "../../../..");
const hasContent = fs.existsSync(path.join(root, "content"));
const content: Content = hasContent
  ? JSON.parse(execFileSync(process.execPath, [path.join(root, "reference/content.mjs")], { encoding: "utf8" }))
  : { cases: [], drugs: {}, protocols: {} };

const row = (station: string, title: string, checklist: [string, boolean, boolean?][], errors: string[] = []): ResultRow => ({
  id: 0,
  user_id: "u",
  scenario: "x/y",
  title,
  station,
  score_done: checklist.filter(([, done]) => done).length,
  score_total: checklist.length,
  critical_missed: 0,
  duration_sec: 600,
  details: { checklist: checklist.map(([label, done, critical]) => ({ label, done, critical: !!critical, late: false })), errors, warnings: [], complication: null },
  created_at: "2026-10-05T10:00:00Z",
});

describe("weak spots", () => {
  it("ranks missed items by how often they were missed when they applied", () => {
    const s = weakSpots([
      row("קרדיו", "ACS", [["אספירין", false, true], ["מוניטור", true]], ["ניטרו: לחץ דם נמוך"]),
      row("קרדיו", "ACS", [["אספירין", true, true], ["מוניטור", false]], ["ניטרו: לחץ דם נמוך"]),
      row("מצחים", "אסתמה", [["ונטולין", false], ["מוניטור", true]]),
    ]);
    expect(s.runs).toBe(3);
    expect(s.missed[0]).toEqual({ label: "ונטולין", critical: false, missed: 1, of: 1 });
    expect(s.missed.find((m) => m.label === "מוניטור")).toMatchObject({ missed: 1, of: 3 });
    expect(s.errors).toEqual([{ text: "ניטרו: לחץ דם נמוך", count: 2 }]);
    // Each cardio run had one error: 50% of steps − 10 points.
    expect(s.stations).toEqual([
      { station: "קרדיו", avg: 40, runs: 2 },
      { station: "מצחים", avg: 50, runs: 1 },
    ]);
  });

  it("an empty history has nothing to show", () => {
    expect(weakSpots([])).toMatchObject({ runs: 0, missed: [], errors: [], stations: [] });
  });
});

describe.skipIf(!hasContent)("saved result", () => {
  const play = (lines: string[]) => {
    let sim: Sim = startSim(content, "acs", 4, "anterior");
    for (const l of lines) sim = step(content, sim, l).sim;
    return sim;
  };

  it("a finished run saves its score and full checklist", () => {
    const r = buildResult(content, play(["מוניטור", "אקג 12", "אספירין 300 מג בלעיסה", "סיום"]))!;
    expect(r.scenario).toBe("acs/anterior");
    expect(r.station).toBe("קרדיו");
    expect(r.score_total).toBe(r.details.checklist.length);
    expect(r.score_done).toBe(r.details.checklist.filter((c) => c.done).length);
    expect(r.details.checklist.some((c) => c.label.includes("אספירין") && c.done)).toBe(true);
  });

  it("unfinished or barely-started runs aren't saved", () => {
    expect(buildResult(content, play(["מוניטור"]))).toBeNull();
    expect(buildResult(content, play(["מוניטור", "סיום"]))).toBeNull();
  });
});
