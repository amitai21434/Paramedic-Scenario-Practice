// Bundles the private scenario content (content/ — git-ignored) into the one
// JSON object the website loads: { cases, drugs, protocols, complications }.
//
//   node reference/content.mjs            prints the bundle as JSON
//
// Used by the dev server (served at /dev-content.json, so content edits show
// up on refresh), by the tests, and by upload-content.mjs.

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const contentDir = path.join(root, "content");
const casesDir = path.join(contentDir, "cases");

export async function buildBundle() {
  if (!fs.existsSync(contentDir)) throw new Error(`No content folder at ${contentDir}`);
  const load = async (file) => (await import(pathToFileURL(file).href)).default;

  const drugs = await load(path.join(contentDir, "drugs.mjs"));
  const cases = [];
  for (const file of fs.readdirSync(casesDir).sort()) {
    if (!file.endsWith(".mjs") || file === "shared.mjs") continue;
    // A file exports one scenario, or an array of related ones.
    for (const c of [await load(path.join(casesDir, file))].flat()) {
      if (!c?.id) throw new Error(`${file} doesn't export a scenario with an id`);
      if (cases.some((x) => x.id === c.id)) throw new Error(`Duplicate scenario id "${c.id}" in ${file}`);
      cases.push(c);
    }
  }

  // Protocol titles for the debrief, from the split book (if present).
  const protocols = {};
  const split = path.join(root, "reference", "out", "protocols.json");
  if (fs.existsSync(split)) {
    for (const p of JSON.parse(fs.readFileSync(split, "utf8"))) {
      protocols[p.id] = p.title;
      if (p.part) protocols[p.id.replace(/-\d+$/, "")] ??= p.title; // "08-09-1" also answers to "08-09"
    }
  }
  // Expected diagnoses per storyline (content/diagnoses.mjs), attached to each variant.
  const dxFile = path.join(contentDir, "diagnoses.mjs");
  if (fs.existsSync(dxFile)) {
    const dx = await load(dxFile);
    for (const c of cases) {
      if (c.variants?.length) for (const v of c.variants) v.diagnoses = dx[`${c.id}/${v.id}`];
      else c.diagnoses = dx[c.id];
    }
    const known = new Set(cases.flatMap((c) => (c.variants?.length ? c.variants.map((v) => `${c.id}/${v.id}`) : [c.id])));
    for (const key of Object.keys(dx)) if (!known.has(key)) throw new Error(`diagnoses.mjs: no storyline "${key}"`);
  }

  // Titles for protocols the splitter merged into a neighbour (content/protocols.mjs).
  const extra = path.join(contentDir, "protocols.mjs");
  if (fs.existsSync(extra)) Object.assign(protocols, await load(extra));

  // Random complications shared by all scenarios (content/complications.mjs).
  const compFile = path.join(contentDir, "complications.mjs");
  const complications = fs.existsSync(compFile) ? await load(compFile) : {};

  // JSON round-trip drops functions/undefined and catches anything unserializable.
  return JSON.parse(JSON.stringify({ cases, drugs, protocols, complications }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  process.stdout.write(JSON.stringify(await buildBundle()));
}
