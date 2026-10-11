// Opt-in (EQUIV=1, ~3 min): replays every by-the-book script from the other test files rewritten in the
// first real tester's style — merged steps, "אני…", delegation, reasoning words, typos — and checks the
// result matches the plain script. fixtures/by-the-book-scripts.json was recorded from those tests.
// Differences are written to the OS temp folder (tester-equivalence-*.txt).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { describe, expect, it } from "vitest";
import { debrief } from "../debrief";
import { startSim, step } from "../engine";
import { generate } from "../generate";
import type { Sim } from "../types";

const root = path.resolve(import.meta.dirname, "../../../..");
const hasContent = fs.existsSync(path.join(root, "content"));
const content = !hasContent ? { cases: [] } : JSON.parse(execFileSync(process.execPath, [path.join(root, "reference/content.mjs")], { encoding: "utf8" }));
const OUT = os.tmpdir();
type Script = { id: string; variant: string | null; seed: number; complications: string[] | null; lines: string[] };
/** Seed for a coverage script: first patient with no allergy drug and the script's case variables. */
function coverageSeed(id: string, variant: string | null, vars: Record<string, number> = {}, facts: string[] = []): number {
  const t = content.cases.find((c: { id: string }) => c.id === id);
  for (let seed = 1; seed < 5000; seed++) {
    const c = generate(t, seed, variant ?? undefined);
    if (!c.allergyDrug && Object.entries(vars).every(([k, v]) => c.vars[k] === v) && facts.every((x) => c.facts.includes(x))) return seed;
  }
  throw new Error(`no seed for ${id}/${variant}`);
}

const fixture = (name: string) => JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "fixtures", name), "utf8"));
const scripts: Script[] = !hasContent ? [] : [
  ...fixture("by-the-book-scripts.json"),
  // coverage.test.ts — storylines the other files don't walk through.
  ...fixture("coverage-scripts.json").map((c: { id: string; variant: string | null; seedVars?: Record<string, number>; lines: string[] }) => ({
    id: c.id, variant: c.variant, seed: coverageSeed(c.id, c.variant, c.seedVars), complications: null, lines: c.lines,
  })),
  // mistakes.test.ts — the penalty must fire however the mistake is phrased.
  ...fixture("mistake-scripts.json").map((c: { id: string; variant: string | null; seedVars?: Record<string, number>; seedFacts?: string[]; lines: string[] }) => ({
    id: c.id, variant: c.variant, seed: coverageSeed(c.id, c.variant, c.seedVars, c.seedFacts), complications: null, lines: c.lines,
  })),
];

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

const FEM: Record<string, string> = {
  פותח: "פותחת", נותן: "נותנת", מחבר: "מחברת", בודק: "בודקת", מודד: "מודדת", מושיב: "מושיבה", משכיב: "משכיבה",
  מנשים: "מנשימה", מתחיל: "מתחילה", מקבע: "מקבעת", שואל: "שואלת", מכניס: "מכניסה", מוריד: "מורידה", מרים: "מרימה",
  מזמין: "מזמינה", מבצע: "מבצעת", מקשיב: "מקשיבה", מחמם: "מחממת", מייבש: "מייבשת", שוטף: "שוטפת", מוסיף: "מוסיפה",
  ממשיך: "ממשיכה", חוזר: "חוזרת", מסיר: "מסירה", מתקשר: "מתקשרת", מודיע: "מודיעה", מדווח: "מדווחת", חושד: "חושדת",
  מעסה: "מעסה", שם: "שמה", מצמיד: "מצמידה", מחדיר: "מחדירה", מזריק: "מזריקה", מאזין: "מאזינה", מפנה: "מפנה",
  מכסה: "מכסה", מעביר: "מעבירה", מפעיל: "מפעילה", מרגיע: "מרגיעה", סופר: "סופרת", מגן: "מגינה", מטפל: "מטפלת",
};
const INF: Record<string, string> = { פותח: "לפתוח", מחבר: "לחבר", מודד: "למדוד", בודק: "לבדוק", נותן: "לתת", מכניס: "להכניס" };
const TYPO: [string, string][] = [["ק", "כ"], ["כ", "ק"], ["א", "ע"], ["ע", "א"], ["ט", "ת"], ["ת", "ט"], ["ס", "ש"], ["ח", "כ"]];

const FILLER = ["עכשיו ", "אוקיי, ", "אחרי זה ", "", "", ""];
const DRUGISH = /מג|מקג|מל|גרם|IV|IM|לשריר|לוריד|באינהלציה/;
function styleLine(line: string, r: () => number): string {
  const words = line.split(" ");
  const first = words[0];
  const pre = FILLER[Math.floor(r() * FILLER.length)] + (DRUGISH.test(line) && r() < 0.3 ? "בגלל שהמצב לא משתפר, " : "");
  const p = r();
  if (INF[first] && p < 0.3) return pre + `אני מבקשת מהאיש צוות ${INF[first]} ${words.slice(1).join(" ")}`;
  if (INF[first] && p < 0.5) return pre + `אני רוצה ${INF[first]} ${words.slice(1).join(" ")}`;
  if (FEM[first]) return pre + `אני ${[FEM[first], ...words.slice(1)].join(" ")}`;
  if (line.endsWith("?") && p < 0.5) return line.slice(0, -1);
  return pre + line;
}

function typo(text: string, r: () => number): string {
  if (r() < 0.5) return text;
  const words = text.split(" ");
  const cand = words.map((w, i) => [w, i] as const).filter(([w]) => /^[א-ת]{6,}$/.test(w));
  if (!cand.length) return text;
  const [w, i] = cand[Math.floor(r() * cand.length)];
  const pairs = TYPO.filter(([a]) => w.slice(1).includes(a));
  if (!pairs.length) return text;
  const [a, b] = pairs[Math.floor(r() * pairs.length)];
  const k = w.indexOf(a, 1);
  words[i] = w.slice(0, k) + b + w.slice(k + 1);
  return words.join(" ");
}

const SOLO = (l: string) => l === "ממתין" || l === "סיום" || /^\d/.test(l) || l.length < 3;

function styled(s: Script, withTypos: boolean, k: number): string[] {
  const r = rng(s.seed * 31 + s.lines.length + k * 7919);
  const out: string[] = [];
  let i = 0;
  while (i < s.lines.length) {
    const l = s.lines[i];
    if (SOLO(l)) {
      out.push(l);
      i++;
      continue;
    }
    const take = r() < 0.5 && i + 1 < s.lines.length && !SOLO(s.lines[i + 1]) ? 2 : 1;
    const parts = s.lines.slice(i, i + take).map((x) => styleLine(x, r));
    let msg = parts[0];
    for (const p of parts.slice(1)) msg += (r() < 0.5 ? ", " : " ") + (p.startsWith("אני ") ? `ואני ${p.slice(4)}` : `ו${p}`);
    out.push(withTypos ? typo(msg, r) : msg);
    i += take;
  }
  return out;
}

function play(s: Script, lines: string[]) {
  let sim: Sim = startSim(content, s.id, s.seed, s.variant ?? undefined, s.complications ?? undefined);
  const notUnderstood: string[] = [];
  for (const l of lines) {
    const res = step(content, sim, l);
    if (!res.understood) notUnderstood.push(l);
    sim = res.sim;
  }
  const d = debrief(content, sim);
  return {
    done: new Set(d.checklist.filter((c) => c.doneAt !== null).map((c) => c.label)),
    errors: new Set(d.errors.map((e) => e.text)),
    state: sim.state,
    notUnderstood,
    sim,
  };
}

/** Known differences that come from merging steps (the merged run is faster), not from reading. */
const TIMING_ONLY = ["acs/anterior", "acs/anteriorVf", "loc/hypo"];

describe.skipIf(!process.env.EQUIV || !hasContent)("tester-style equivalence", () => {
for (const withTypos of [false, true]) {
  it(`equivalence ${withTypos ? "with typos" : "style only"}`, () => {
    const report: string[] = [];
    let bad = 0;
    for (const s0 of scripts) for (let k = 0; k < 5; k++) {
      const s = s0;
      const a = play(s, s.lines);
      const lines = styled(s, withTypos, k);
      const b = play(s, lines);
      const lost = [...a.done].filter((x) => !b.done.has(x));
      const extraDone = [...b.done].filter((x) => !a.done.has(x));
      const newErr = [...b.errors].filter((x) => !a.errors.has(x));
      const lostErr = [...a.errors].filter((x) => !b.errors.has(x));
      const nu = b.notUnderstood.filter((x) => !a.notUnderstood.some((y) => x.includes(y)));
      if (!lost.length && !newErr.length && !lostErr.length && !nu.length && a.state === b.state && !extraDone.length) continue;
      bad++;
      report.push(`\n### ${s.id}/${s.variant} seed ${s.seed}`);
      if (a.state !== b.state) report.push(`  state: ${a.state} -> ${b.state}`);
      for (const x of lost) report.push(`  LOST ✓ ${x}`);
      for (const x of extraDone) report.push(`  EXTRA ✓ ${x}`);
      for (const x of newErr) report.push(`  NEW ERR ${x}`);
      for (const x of lostErr) report.push(`  LOST ERR ${x}`);
      for (const x of nu) report.push(`  NOT UNDERSTOOD: ${x}`);
      report.push("  styled: " + lines.map((l) => `«${l}»`).join(" "));
      // What the styled run read, per message
      const msgs = b.sim.messages.filter((m) => m.from === "user") as { text: string; items?: string[] }[];
      report.push("  read: " + msgs.map((m) => `[${(m.items ?? []).join("; ")}]`).join(" "));
    }
    fs.writeFileSync(path.join(OUT, `tester-equivalence-${withTypos ? "typos" : "style"}.txt`), `${scripts.length * 5 - bad}/${scripts.length * 5} equivalent\n` + report.join("\n"));
    expect(report.filter((l) => l.startsWith("### ") && !TIMING_ONLY.some((id) => l.startsWith(`### ${id} `)))).toEqual([]);
  }, 600000);
}
});
