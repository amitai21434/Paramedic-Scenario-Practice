// Splits the protocol book's chapter text files into individual protocols,
// and records which medications (chapter 10) and skills (chapter 9) each
// protocol mentions, so the chat can look up exactly the pages it needs.
//
// Usage:
//   node reference/split-protocols.mjs "<folder with 01_...txt – 10_...txt>"
//
// Output (git-ignored — the book is copyrighted, never commit it):
//   reference/out/protocols.json   one entry per protocol (or protocol part)
//   reference/out/INDEX.md         human-readable summary for review
//
// How the book is structured (verified against the text): every page starts
// with a form feed, then a header line "<page#>   <k> <protocol title>" where
// k is the page's position within that protocol (k = 1 starts a new protocol).
// Each page also ends with the footer "פרק N  תוכן עניינים כללי".

import fs from "node:fs";
import path from "node:path";

const inputDir = process.argv[2];
if (!inputDir || !fs.existsSync(inputDir)) {
  console.error('Usage: node reference/split-protocols.mjs "<folder with chapter .txt files>"');
  process.exit(1);
}
const outDir = path.join(import.meta.dirname, "out");

// Pieces larger than this are split into parts at page boundaries.
const MAX_TOKENS = 6000;
// Measured with DictaLM's tokenizer on this book: ~2 characters per token.
const estTokens = (text) => Math.round(text.length / 2);

// ---------------------------------------------------------------------------
// Cross-reference aliases. Hebrew aliases match as substrings (so prefixed
// forms like "בדורמיקום" / "לטובוס" match); Latin ones match as whole words,
// case-insensitive. `title` picks the protocol in chapter 9/10 it points to.
// ---------------------------------------------------------------------------
const DRUGS = [
  { title: "אדנוזין", aliases: ["אדנוזין", "adenosine"] },
  { title: "אדרנלין", aliases: ["אדרנלין", "אפינפרין", "adrenalin", "adrenaline", "epinephrine"] },
  { title: "אופטלגין", aliases: ["אופטלגין", "dipyrone", "metamizole"] },
  { title: "אטומידאט", aliases: ["אטומידאט", "etomidate"] },
  { title: "אטרופין", aliases: ["אטרופין", "atropine"] },
  { title: "איזוקט", aliases: ["איזוקט", "isosorbide"] },
  { title: "אירובנט", aliases: ["אירובנט", "ipratropium"] },
  { title: "אמיודרון", aliases: ["אמיודרון", "amiodarone"] },
  { title: "אספירין", aliases: ["אספירין", "aspirin", "acetylsalicylic"] },
  { title: "אקמול", aliases: ["אקמול", "acetaminophen", "paracetamol"] },
  { title: "דופמין", aliases: ["דופמין", "dopamine"] },
  { title: "דורמיקום", aliases: ["דורמיקום", "midazolam"] },
  { title: "דקסטרוז", aliases: ["דקסטרוז", "גלוקוז", "dextrose", "glucose"] },
  { title: "דרופרידול", aliases: ["דרופרידול", "droperidol"] },
  { title: "הידרוקסיקובלמין", aliases: ["הידרוקסיקובלמין", "ציאנוקיט", "cyanokit", "hydroxocobalamin"] },
  { title: "הפרין", aliases: ["הפרין", "heparin"] },
  { title: "הקסקפרון", aliases: ["הקסקפרון", "tranexamic"] },
  { title: "ונטולין", aliases: ["ונטולין", "salbutamol"] },
  { title: "זופרן", aliases: ["זופרן", "ondansetron"] },
  { title: "טרמדקס", aliases: ["טרמדקס", "tramadol"] },
  { title: "לבטלול", aliases: ["לבטלול", "labetalol", "trandate"] },
  { title: "מגנזיום", aliases: ["מגנזיום", "magnesium"] },
  { title: "מטופרולול", aliases: ["מטופרולול", "metoprolol"] },
  { title: "ניטרולינגואל", aliases: ["ניטרולינגואל", "ניטרוגליצרין", "ניטרטים", "ניטרו", "nitroglycerin", "glyceryl trinitrate"] },
  { title: "נרקן", aliases: ["נרקן", "naloxone"] },
  { title: "סוגמדקס", aliases: ["סוגמדקס", "sugammadex"] },
  { title: "סודיום ביקרבונט", aliases: ["ביקרבונט", "bicarbonate"] },
  { title: "סודיום תיוסולפט", aliases: ["תיוסולפט", "thiosulfate"] },
  { title: "סולומדרול", aliases: ["סולומדרול", "methylprednisolone"] },
  { title: "פוסיד", aliases: ["פוסיד", "furosemide"] },
  { title: "פנטניל", aliases: ["פנטניל", "fentanyl"] },
  { title: "קטמין", aliases: ["קטמין", "ketamine"] },
  { title: "קלציום", aliases: ["קלציום", "calcium"] },
  { title: "רוקורוניום", aliases: ["רוקורוניום", "rocuronium"] },
];

const SKILLS = [
  { title: "אינטובציה", aliases: ["אינטובציה", "טובוס", "intubation"] },
  { title: "נתיב אוויר סופראגלוטי", aliases: ["סופראגלוטי", "supraglottic", "i-gel", "igel"] },
  { title: "קריקוטומיה", aliases: ["קריקוטומיה", "cricothyrotomy", "cricothyroidotomy"] },
  { title: "CPAP", aliases: ["CPAP"] },
  { title: "ניקור חזה", aliases: ["ניקור חזה", "נידל", "needle"] },
  { title: "LUCAS", aliases: ["LUCAS", "מעסה לב"] },
  { title: "עירוי תוך־גרמי", aliases: ["תוך־גרמי", "תוך גרמי", "תוך־לשדי", "תוך לשדי", "NIO", "BIG"] },
  { title: "קיצוב חיצוני", aliases: ["קיצוב", "pacing"] },
  { title: "פלזמה", aliases: ["פלזמה מיובשת", "פלזמה קפואה", "FDP"] },
  { title: "בורר זרימה", aliases: ["בורר זרימה"] },
  { title: "הידרוקסיקובלמין", aliases: ["הידרוקסיקובלמין", "ציאנוקיט", "cyanokit"] },
  { title: "אפיפן", aliases: ["אפיפן", "epipen"] },
  { title: "חבישה המוסטטית", aliases: ["המוסטטית", "axiostat", "packing"] },
  { title: "מקבע אגן", aliases: ["מקבע אגן"] },
  { title: "חסם עורקים", aliases: ["חסם עורקים", "חוסם עורקים", "tourniquet"] },
];

// ---------------------------------------------------------------------------

const BIDI_MARKS = /[‎‏‪-‮⁦-⁩]/g;
const HEADER = /^(\d{2,3})\s{2,}(\d{1,2})\s*([^\d\s].*)$/;
const FOOTER = /^פרק\s+\d+\s+תוכן עניינים כללי$/;
const PAGE_NUMBER_ONLY = /^\d{1,3}$/;

function cleanLine(line) {
  return (
    line
      .replace(/\t/g, " ")
      .trim()
      .replace(/\s{3,}/g, " | ") // PDF columns (flowchart | explanations) end up on one line
      .replace(/\s{2}/g, " ")
      // "+" bullet markers, at line start or at the start of a column
      .replace(/^\+\s*|\s*\|\s*\+$/g, "• ")
      .replace(/\s*\|\s*\+\s*\|\s*/g, " | • ")
      .replace(/(\|\s)\+(?=\S)/g, "$1• ")
      // Right-to-left extraction moves a sentence's final period in front of a
      // leading number: ".90 mmHg" → "90 mmHg", ".1ככלל" → "1. ככלל".
      // (Decimals like "0.4" are untouched: their period follows a digit.)
      .replace(/(^|[\s|(])\.(\d{1,2})(?=[א-ת])/g, "$1$2. ")
      .replace(/(^|[\s|(])\.(\d)/g, "$1$2")
      .trim()
  );
}

// Fixes that apply to titles and body text alike.
function fixText(s) {
  return (
    s
      // Mirrored brackets around Latin text: "()ACS" → "(ACS)"
      .replace(/\(\)([A-Za-z][A-Za-z0-9 ./-]*)/g, "($1)")
      // Right-to-left extraction reverses number ranges: "5−3 דקות" is 3–5
      // minutes, "30–10 נשימות" is 10–30. A range never runs high→low, so
      // swap any descending one. ("160–325 mg" is already ascending: kept.)
      .replace(/(\d+(?:\.\d+)?)\s?[-–−]\s?(\d+(?:\.\d+)?)(?![\d.])/g, (m, a, b) =>
        Number(a) > Number(b) ? `${b}–${a}` : m,
      )
      // Space between a number/unit and the Hebrew word glued to it:
      // "0.4 mgבתוך" → "0.4 mg בתוך", "3מנות" → "3 מנות"
      .replace(/([0-9A-Za-z%])(?=[א-ת])/g, "$1 ")
  );
}

function parsePage(raw) {
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let header = null;
  const body = [];
  for (const [i, line] of lines.entries()) {
    const m = i < 3 && !header ? line.replace(/\s+$/, "").match(HEADER) : null;
    if (m) {
      header = { page: +m[1], k: +m[2], title: fixText(m[3].replace(/\s+/g, " ").trim()) };
      continue;
    }
    const cleaned = fixText(cleanLine(line));
    if (FOOTER.test(cleaned.replace(/\s*\|\s*/g, "  ").replace(/\s+/g, " ")) || /תוכן עניינים כללי/.test(cleaned) && cleaned.length < 40) continue;
    if (!header && PAGE_NUMBER_ONLY.test(cleaned) && i === 0) {
      header = { page: +cleaned, k: null, title: null }; // untitled continuation page
      continue;
    }
    body.push(cleaned);
  }
  return { header, text: body.join("\n").trim() };
}

function splitChapter(file) {
  const [, num, name] = path.basename(file, ".txt").match(/^(\d+)_(.+)$/);
  const chapter = +num;
  const chapterTitle = name.replace(/_/g, " ");
  const pages = fs.readFileSync(file, "utf8").replace(BIDI_MARKS, "").split("\f");

  const protocols = [];
  let current = null;
  let pendingPages = []; // untitled pages seen before the first titled one (ch1 intro)

  // pages[0] is the chapter cover / table of contents — skip it.
  for (const raw of pages.slice(1)) {
    const { header, text } = parsePage(raw);
    if (!text) continue;
    const pageNo = header?.page ?? null;

    // Only k = 1 starts a protocol. Later pages often carry a longer title
    // ("… דגשים נוספים") but still belong to the same protocol.
    if (header?.title && (header.k === 1 || !current)) {
      current = { chapter, chapterTitle, title: header.title, pages: [], chunks: [] };
      protocols.push(current);
      for (const p of pendingPages) { current.pages.push(p.page); current.chunks.push(p.text); }
      pendingPages = [];
    }
    if (!current) {
      pendingPages.push({ page: pageNo, text });
      continue;
    }
    if (pageNo) current.pages.push(pageNo);
    current.chunks.push(text);
  }
  return protocols;
}

function findRefs(text, table, selfTitle) {
  const refs = [];
  for (const { title, aliases } of table) {
    if (selfTitle?.includes(title)) continue;
    const hit = aliases.some((a) =>
      /[a-z]/i.test(a)
        ? new RegExp(`(^|[^a-z])${a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`, "i").test(text)
        : text.includes(a),
    );
    if (hit) refs.push(title);
  }
  return refs;
}

// Split oversized protocols into parts at page boundaries.
function toParts(p) {
  const total = estTokens(p.chunks.join("\n\n"));
  if (total <= MAX_TOKENS) return [{ ...p, part: null, text: p.chunks.join("\n\n") }];
  const parts = [];
  let cur = { pages: [], chunks: [] };
  p.chunks.forEach((chunk, i) => {
    if (cur.chunks.length && estTokens([...cur.chunks, chunk].join("\n\n")) > MAX_TOKENS) {
      parts.push(cur);
      cur = { pages: [], chunks: [] };
    }
    cur.chunks.push(chunk);
    if (p.pages[i] != null) cur.pages.push(p.pages[i]);
  });
  parts.push(cur);
  return parts.map((part, i) => ({
    ...p,
    pages: part.pages,
    part: `${i + 1}/${parts.length}`,
    text: part.chunks.join("\n\n"),
  }));
}

// ---------------------------------------------------------------------------

const files = fs
  .readdirSync(inputDir)
  .filter((f) => /^\d+_.+\.txt$/.test(f))
  .sort()
  .map((f) => path.join(inputDir, f));

const entries = [];
for (const file of files) {
  const protocols = splitChapter(file);
  protocols.forEach((p, idx) => {
    for (const piece of toParts(p)) {
      const pages = piece.pages.filter((n) => n != null);
      entries.push({
        id: `${String(p.chapter).padStart(2, "0")}-${String(idx + 1).padStart(2, "0")}${piece.part ? `-${piece.part.split("/")[0]}` : ""}`,
        chapter: p.chapter,
        chapterTitle: p.chapterTitle,
        title: p.title,
        part: piece.part,
        pageFrom: pages.length ? Math.min(...pages) : null,
        pageTo: pages.length ? Math.max(...pages) : null,
        estTokens: estTokens(piece.text),
        drugs: p.chapter === 10 ? [] : findRefs(piece.text, DRUGS, null),
        skills: p.chapter === 9 ? [] : findRefs(piece.text, SKILLS, null),
        text: piece.text,
      });
    }
  });
}

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "protocols.json"), JSON.stringify(entries, null, 2));

// Human-readable index for review.
const lines = ["# Protocol index", "", `${entries.length} pieces · ~${entries.reduce((s, e) => s + e.estTokens, 0).toLocaleString()} tokens total`, ""];
let lastChapter = null;
for (const e of entries) {
  if (e.chapter !== lastChapter) {
    lines.push("", `## ${e.chapter}. ${e.chapterTitle}`, "", "| id | protocol | pages | ~tokens | medications | skills |", "|---|---|---|---|---|---|");
    lastChapter = e.chapter;
  }
  const pages = e.pageFrom === e.pageTo ? `${e.pageFrom}` : `${e.pageFrom}–${e.pageTo}`;
  lines.push(`| ${e.id} | ${e.title}${e.part ? ` (חלק ${e.part})` : ""} | ${pages} | ${e.estTokens} | ${e.drugs.join(", ")} | ${e.skills.join(", ")} |`);
}
fs.writeFileSync(path.join(outDir, "INDEX.md"), lines.join("\n") + "\n");

const big = entries.filter((e) => e.estTokens > MAX_TOKENS);
console.log(`Wrote ${entries.length} pieces from ${files.length} chapters to ${path.relative(process.cwd(), outDir)}`);
console.log(`Largest piece: ~${Math.max(...entries.map((e) => e.estTokens))} tokens${big.length ? ` (${big.length} over limit!)` : ""}`);
