// Turns reference/out/protocols.json into SQL that replaces the contents of
// the private `reference_pieces` table. Run after split-protocols.mjs:
//
//   node reference/upload-sql.mjs
//   npx supabase db query --linked -f reference/out/upload-1.sql   (etc.)
//
// The SQL goes through the Supabase CLI's linked connection, so no secret
// keys are needed. Files are written to reference/out/ (git-ignored).

import fs from "node:fs";
import path from "node:path";

const outDir = path.join(import.meta.dirname, "out");
const entries = JSON.parse(fs.readFileSync(path.join(outDir, "protocols.json"), "utf8"));

// Dollar-quoting avoids escaping Hebrew quotes (״ " ') in the book text.
const TAG = "$ref$";
const q = (s) => {
  if (s == null) return "null";
  if (String(s).includes(TAG)) throw new Error(`Text contains ${TAG}`);
  return `${TAG}${s}${TAG}`;
};
const arr = (a) => `array[${a.map(q).join(",")}]::text[]`;

const rows = entries.map(
  (e) =>
    `(${q(e.id)}, ${e.chapter}, ${q(e.chapterTitle)}, ${q(e.title)}, ${q(e.part)}, ` +
    `${e.pageFrom ?? "null"}, ${e.pageTo ?? "null"}, ${e.estTokens}, ${arr(e.drugs)}, ${arr(e.skills)}, ${q(e.text)})`,
);

// Keep each file small enough for the Management API.
const MAX_BYTES = 120_000;
const files = [];
let batch = [];
let size = 0;
for (const row of rows) {
  if (batch.length && size + row.length > MAX_BYTES) {
    files.push(batch);
    batch = [];
    size = 0;
  }
  batch.push(row);
  size += Buffer.byteLength(row);
}
files.push(batch);

const cols = "(id, chapter, chapter_title, title, part, page_from, page_to, est_tokens, drugs, skills, body)";
files.forEach((b, i) => {
  const sql =
    (i === 0 ? "delete from public.reference_pieces;\n" : "") +
    `insert into public.reference_pieces ${cols} values\n${b.join(",\n")};\n`;
  fs.writeFileSync(path.join(outDir, `upload-${i + 1}.sql`), sql);
});
console.log(`Wrote ${files.length} SQL file(s) for ${rows.length} pieces to ${path.relative(process.cwd(), outDir)}`);
