// By-the-book play-throughs for the storylines the other test files don't walk through, so every
// storyline has at least one correct run (also replayed in the tester's style by tester-equivalence).
// Each must be understood throughout, make no errors, miss no critical step and end in the good state.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { debrief } from "../debrief";
import { startSim, step } from "../engine";
import { generate } from "../generate";
import type { Content, Sim } from "../types";

const root = path.resolve(import.meta.dirname, "../../../..");
const hasContent = fs.existsSync(path.join(root, "content"));
const content: Content = hasContent
  ? JSON.parse(execFileSync(process.execPath, [path.join(root, "reference/content.mjs")], { encoding: "utf8" }))
  : { cases: [], drugs: {}, protocols: {} };

export type CoverageScript = { id: string; variant: string | null; seedVars?: Record<string, number>; end: string[]; lines: string[] };
export const COVERAGE: CoverageScript[] = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "fixtures/coverage-scripts.json"), "utf8"));

/** First seed whose patient fits the script (no allergy drug, and any required case variables). */
export function coverageSeed(s: CoverageScript): number {
  const t = content.cases.find((c) => c.id === s.id)!;
  for (let seed = 1; seed < 5000; seed++) {
    const c = generate(t, seed, s.variant ?? undefined);
    if (!c.allergyDrug && Object.entries(s.seedVars ?? {}).every(([k, v]) => c.vars[k] === v)) return seed;
  }
  throw new Error(`no seed for ${s.id}/${s.variant}`);
}

describe.skipIf(!hasContent)("every storyline has a correct run", () => {
  for (const s of COVERAGE) {
    it(`${s.id}/${s.variant ?? "-"}`, () => {
      let sim: Sim = startSim(content, s.id, coverageSeed(s), s.variant ?? undefined);
      for (const line of s.lines) {
        const r = step(content, sim, line);
        expect(r.understood, `not understood: ${line}`).toBe(true);
        sim = r.sim;
      }
      const d = debrief(content, sim);
      expect(d.errors.map((e) => e.text)).toEqual([]);
      expect(d.checklist.filter((c) => c.critical && c.doneAt === null).map((c) => c.label)).toEqual([]);
      expect(s.end).toContain(sim.state);
    });
  }
});
