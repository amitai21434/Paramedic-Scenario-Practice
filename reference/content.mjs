// Bundles the private scenario content (content/ — git-ignored) into the one
// JSON object the website loads: { cases, drugs, protocols }.
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
    const c = await load(path.join(casesDir, file));
    if (!c?.id) throw new Error(`${file} doesn't export a scenario with an id`);
    cases.push(c);
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
  // JSON round-trip drops functions/undefined and catches anything unserializable.
  return JSON.parse(JSON.stringify({ cases, drugs, protocols }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  process.stdout.write(JSON.stringify(await buildBundle()));
}
