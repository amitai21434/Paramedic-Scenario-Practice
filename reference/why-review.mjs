// Builds content/why-review.html: every "why it matters" line, grouped by storyline (each step listed
// once, where it first appears), for clinical review. Printable, with a column for comments.
//
//   node reference/why-review.mjs

import fs from "node:fs";
import path from "node:path";
import { buildBundle } from "./content.mjs";

const root = path.resolve(import.meta.dirname, "..");
const { cases, complications, why, protocols } = await buildBundle();

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// Gendered text ("[[הפעוט|הפעוטה]]") shows the first form.
const plain = (s) => String(s).replace(/\[\[([^|\]]*)\|[^\]]*\]\]/g, "$1");

const seen = new Set();
const sections = [];
const section = (title, protos, items) => {
  const rows = (items ?? []).filter((i) => !seen.has(i.label));
  if (!rows.length) return;
  for (const i of rows) seen.add(i.label);
  sections.push(
    `<section><h2>${esc(plain(title))}</h2>` +
      (protos?.length ? `<p class="protos">${protos.map((p) => `${p} ${esc(protocols[p] ?? "")}`).join(" · ")}</p>` : "") +
      `<table><thead><tr><th>שלב</th><th>למה זה חשוב</th><th class="notes">הערות</th></tr></thead><tbody>` +
      rows
        .map((i) => `<tr><td class="step">${i.critical ? "<b>❗ " : ""}${esc(plain(i.label))}${i.critical ? "</b>" : ""}</td><td>${esc(plain(why[i.label] ?? "— חסר —"))}</td><td class="notes"></td></tr>`)
        .join("") +
      `</tbody></table></section>`,
  );
};
for (const c of cases) {
  section(c.title, c.protocols, c.checklist);
  for (const v of c.variants ?? []) section(`${c.title} — ${v.title ?? v.id}`, v.protocols ?? c.protocols, v.checklist);
}
for (const [id, d] of Object.entries(complications ?? {})) section(`סיבוך: ${d.title ?? id}`, [], d.checklist);

const html = `<!doctype html>
<html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>בדיקת הסברים — למה זה חשוב</title>
<style>
  body { font-family: Arial, "Segoe UI", sans-serif; margin: 24px; color: #111; background: #fff; line-height: 1.5; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .intro { color: #444; max-width: 900px; }
  h2 { font-size: 17px; margin: 28px 0 2px; border-bottom: 2px solid #ddd; padding-bottom: 4px; }
  .protos { color: #666; font-size: 13px; margin: 2px 0 8px; }
  table { border-collapse: collapse; width: 100%; font-size: 14px; }
  th, td { border: 1px solid #ccc; padding: 6px 8px; vertical-align: top; text-align: right; }
  th { background: #f3f3f3; }
  td.step { width: 30%; }
  .notes { width: 22%; }
  section { break-inside: avoid-page; }
  @media print { body { margin: 10mm; } h2 { break-after: avoid; } }
</style></head><body>
<h1>בדיקת הסברים — "למה זה חשוב"</h1>
<p class="intro">בסיכום התרחיש, מתחת לכל שלב שהוחמץ או בוצע באיחור, מופיעה שורה קצרה שמסבירה למה השלב חשוב, עם מספר הפרוטוקול.
כל שלב מופיע כאן פעם אחת — בתרחיש הראשון שבו הוא מופיע (הסבר משותף חוזר בכמה שלבים דומים).
❗ = שלב קריטי. נא לסמן כל הסבר לא מדויק, לא מלא או מנוסח לא טוב בעמודת ההערות.</p>
<p class="intro">${seen.size} שלבים.</p>
${sections.join("\n")}
</body></html>`;
const out = path.join(root, "content", "why-review.html");
fs.writeFileSync(out, html);
console.log(`Wrote ${path.relative(root, out)} — ${seen.size} steps`);
