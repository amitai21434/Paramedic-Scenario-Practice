// Turns the private scenario content (content/) into SQL that replaces the
// bundle in the `scenario_content` table:
//
//   node reference/upload-content.mjs
//   npx supabase db query --linked -f reference/out/content.sql
//
// Run the tests first (cd web && npm test) — they validate the content.
// The SQL file is written to reference/out/ (git-ignored).

import fs from "node:fs";
import path from "node:path";
import { buildBundle } from "./content.mjs";

const bundle = await buildBundle();
const json = JSON.stringify(bundle);

// Dollar-quoting avoids escaping the Hebrew quotes (״ " ') in the content.
const TAG = "$bundle$";
if (json.includes(TAG)) throw new Error(`Content contains ${TAG}`);

const sql =
  `insert into public.scenario_content (id, data) values ('bundle', ${TAG}${json}${TAG}::jsonb)\n` +
  `on conflict (id) do update set data = excluded.data, updated_at = now();\n`;

const outDir = path.join(import.meta.dirname, "out");
fs.mkdirSync(outDir, { recursive: true });
const file = path.join(outDir, "content.sql");
fs.writeFileSync(file, sql);
console.log(
  `Wrote ${path.relative(process.cwd(), file)} — ${bundle.cases.length} scenarios, ` +
    `${bundle.cases.reduce((n, c) => n + (c.variants?.length || 1), 0)} variants, ${(Buffer.byteLength(sql) / 1024).toFixed(0)} KB`,
);
