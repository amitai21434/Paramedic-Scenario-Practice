// Every checklist step in every storyline (and every complication) has a "why it matters" line,
// and the debrief shows it only under steps that were missed or late.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { debrief } from "../debrief";
import { startSim, step } from "../engine";
import type { Content } from "../types";

const root = path.resolve(import.meta.dirname, "../../../..");
const hasContent = fs.existsSync(path.join(root, "content"));
const content: Content = hasContent
  ? JSON.parse(execFileSync(process.execPath, [path.join(root, "reference/content.mjs")], { encoding: "utf8" }))
  : { cases: [], drugs: {}, protocols: {} };

describe.skipIf(!hasContent)("why it matters", () => {
  it("every checklist label has an explanation, and no explanation is orphaned", () => {
    const labels = new Set<string>();
    for (const c of content.cases) {
      for (const i of c.checklist ?? []) labels.add(i.label);
      for (const v of c.variants ?? []) for (const i of v.checklist ?? []) labels.add(i.label);
    }
    for (const d of Object.values(content.complications ?? {})) for (const i of d.checklist ?? []) labels.add(i.label);
    const why = content.why ?? {};
    expect([...labels].filter((l) => !why[l])).toEqual([]);
    expect(Object.keys(why).filter((k) => !labels.has(k))).toEqual([]);
    expect(Object.values(why).filter((t) => t.length < 20 || t.length > 260)).toEqual([]);
  });

  it("the debrief shows it under missed steps, with the storyline's protocol", () => {
    let sim = startSim(content, "acs", 4, "anterior");
    for (const l of ["מחבר מוניטור", "סיום"]) sim = step(content, sim, l).sim;
    const d = debrief(content, sim);
    const aspirin = d.checklist.find((c) => c.label.startsWith("אספירין"))!;
    expect(aspirin.doneAt).toBeNull();
    expect(aspirin.why).toMatch(/טסיות/);
    expect(aspirin.ref).toBe("03-11");
  });

  it("resuscitation steps cite the arrest protocol, after-ROSC steps 02-04", () => {
    let sim = startSim(content, "acs", 4, "anteriorVf");
    sim = step(content, sim, "סיום").sim;
    const d = debrief(content, sim);
    expect(d.checklist.find((c) => c.label.startsWith("שוק חשמלי"))!.ref).toBe("02-02");
    expect(d.checklist.find((c) => c.label.startsWith("אחרי ROSC"))!.ref).toBe("02-04");
    expect(d.checklist.find((c) => c.label.startsWith("אספירין"))!.ref).toBe("03-11");
  });
});
