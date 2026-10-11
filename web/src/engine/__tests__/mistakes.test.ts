// Common mistakes, one per script: each must draw its error in the debrief. tester-equivalence replays
// them in the tester's style too, so the penalty also fires when she phrases the mistake her way.

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

type MistakeScript = { id: string; variant: string | null; seedVars?: Record<string, number>; seedFacts?: string[]; errors: string[]; lines: string[] };
const MISTAKES: MistakeScript[] = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "fixtures/mistake-scripts.json"), "utf8"));

function seedFor(s: MistakeScript): number {
  const t = content.cases.find((c) => c.id === s.id)!;
  for (let seed = 1; seed < 5000; seed++) {
    const c = generate(t, seed, s.variant ?? undefined);
    if (c.allergyDrug) continue;
    if (!Object.entries(s.seedVars ?? {}).every(([k, v]) => c.vars[k] === v)) continue;
    if (!(s.seedFacts ?? []).every((f) => c.facts.includes(f))) continue;
    return seed;
  }
  throw new Error(`no seed for ${s.id}/${s.variant}`);
}

describe.skipIf(!hasContent)("common mistakes are caught", () => {
  for (const s of MISTAKES) {
    it(`${s.id}/${s.variant ?? "-"}: ${s.lines.at(-1)}`, () => {
      let sim: Sim = startSim(content, s.id, seedFor(s), s.variant ?? undefined);
      for (const line of s.lines) {
        const r = step(content, sim, line);
        expect(r.understood, `not understood: ${line}`).toBe(true);
        sim = r.sim;
      }
      const errors = debrief(content, sim).errors.map((e) => e.text).join(" | ");
      for (const want of s.errors) expect(errors).toContain(want);
    });
  }
});
