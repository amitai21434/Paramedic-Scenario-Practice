// Free text → ordered list of actions and drug administrations.
//
// No AI: the text is normalized, split into tokens, and matched against the
// lexicon. Drugs are matched first and take the dose/unit/route words that
// follow them, so "אדרנלין 1 מג IV" doesn't also read as "open an IV".

import { ACTIONS, ASK_OR_EXAM, DRUGS, NEGATIONS, NOT_CARRIED, PER_KG, PER_MIN, ROUTES, STATEMENT_TRIGGERS, STOPWORDS, UNITS } from "./lexicon";

export type ParsedItem =
  | { kind: "action"; id: string; joules?: number; phrase: string; withBag?: boolean }
  | { kind: "drug"; drug: string; value: number | null; unit: string | null; route: string | null; phrase: string; conc?: number };

export type Parsed = {
  items: ParsedItem[];
  /** Clauses stating a diagnosis or ECG reading — recorded, not acted on. */
  statements: string[];
  /** A number (with optional unit) that wasn't attached to anything — answers "what dose?". */
  bare: { value: number; unit: string | null } | null;
  negated: string[];
  /** Actions or drugs only got ready ("מוציאה ציוד הנשמה", "מכינה אדנוזין") — not done. */
  prepared: string[];
  /** Treatments only planned ("אם נמוך אתן גלוקוז", "לפני שאני נותנת ניטרו...") — not done. */
  planned: string[];
  /** The IV line was flushed ("שוטפת עם סליין") — not a fluid bolus. */
  flush: boolean;
};

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

const FINALS: Record<string, string> = { "ך": "כ", "ם": "מ", "ן": "נ", "ף": "פ", "ץ": "צ" };
const PREFIXES = new Set(["ו", "ה", "ב", "ל", "מ", "ש", "כ"]);

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[֑-ׇ]/g, "") // niqqud and cantillation
    .replace(/["'`״׳’‘“”]/g, "") // מ"ג → מג, ג'אול → גאול
    .replace(/[ךםןףץ]/g, (c) => FINALS[c])
    .replace(/וו+/g, "ו")
    .replace(/יי+/g, "י")
    .replace(/[־–—-]/g, " ");
}

export function tokenize(text: string): string[] {
  // A concentration ("גלוקוז 25% 100 מל") isn't a dose.
  const norm = normalize(text).replace(/\d+(?:[.,]\d+)?\s*%/g, " ");
  const raw = norm.match(/\d+(?:[.,]\d+)?|[a-z0-9µ]+|[א-ת]+|\//g) ?? [];
  return raw
    .map((t) => (/^\d+,\d{1,2}$/.test(t) ? t.replace(",", ".") : t.replace(",", "")))
    .filter((t) => !STOPWORDS.includes(t));
}

const isHebrew = (t: string) => /^[א-ת]/.test(t);

/** The token as written plus the token with 1–3 Hebrew prefix letters removed. */
function variants(token: string): string[] {
  const out = [token];
  if (!isHebrew(token)) return out;
  let t = token;
  for (let i = 0; i < 3 && t.length > 2 && PREFIXES.has(t[0]); i++) {
    t = t.slice(1);
    out.push(t);
  }
  return out;
}

/** Optimal string alignment distance (Levenshtein + transpositions). */
function distance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

// Words one letter away from a common different word ("מקשיב" vs "מושיב"): exact only.
const NO_TYPO = new Set(["מושיב", "מושיבה", "שואב", "שואבת", "שאיבה", "שטיפה", "מיגון", "לוחץ", "הכרת", "מזעזע", "דקסטרו", "סוכרת", "סכרת", "ישיבה", "בחילה", "בחילות", "איירווי", "טבעות", "קשירה", "קושרת", "ריסון", "מרגיע", "מרגיעה", "חימום", "דימום", "משטרה", "עטיפה", "עוטף", "עוטפת", "נושם", "נושמת", "מדדים", "שוקל", "שוקלת", "ריאות", "לריאות", "מוצץ", "מוצצת", "מציצה", "מגיב", "מגיבה"].map(normalize));

/** 0 = exact, 1 = typo, -1 = no match. */
function tokenMatch(input: string, word: string): number {
  const vs = variants(input);
  if (vs.includes(word)) return 0;
  if (/^\d/.test(word) || word.length < 5 || NO_TYPO.has(word)) return -1;
  const max = word.length >= 9 ? 2 : 1;
  return vs.some((v) => v.length >= 4 && distance(v, word, max) <= max) ? 1 : -1;
}

// ---------------------------------------------------------------------------
// Phrase tables
// ---------------------------------------------------------------------------

type Phrase = { key: string; tokens: string[]; text: string };

function compile(entries: { id: string; words: string[] }[]): Phrase[] {
  return entries.flatMap((e) =>
    e.words.map((w) => ({ key: e.id, tokens: tokenize(w), text: w })).filter((p) => p.tokens.length > 0),
  );
}

const ACTION_PHRASES = compile(ACTIONS);
const DRUG_PHRASES = compile(DRUGS);
const ROUTE_PHRASES = compile(Object.entries(ROUTES).map(([id, words]) => ({ id, words })));
const UNIT_PHRASES = compile(Object.entries(UNITS).map(([id, words]) => ({ id, words })));
const PER_KG_TOKENS = PER_KG.map((w) => tokenize(w)[0]);
const PER_MIN_TOKENS = PER_MIN.map((w) => tokenize(w)[0]);
const NOT_CARRIED_PHRASES = compile(NOT_CARRIED);
const NEGATION_TOKENS = NEGATIONS.map((w) => tokenize(w)[0]).filter(Boolean);

type Match = { phrase: Phrase; start: number; end: number; cost: number };

/** Best phrase starting at token i (longest, then fewest typos), skipping used tokens. */
function bestAt(tokens: string[], used: boolean[], i: number, phrases: Phrase[], exactOnly = false): Match | null {
  let best: Match | null = null;
  for (const phrase of phrases) {
    const n = phrase.tokens.length;
    if (i + n > tokens.length) continue;
    let cost = 0;
    let ok = true;
    for (let k = 0; k < n; k++) {
      if (used[i + k]) {
        ok = false;
        break;
      }
      // Short words (route/unit abbreviations) must match exactly.
      const m = exactOnly ? (variants(tokens[i + k]).includes(phrase.tokens[k]) ? 0 : -1) : tokenMatch(tokens[i + k], phrase.tokens[k]);
      if (m < 0) {
        ok = false;
        break;
      }
      cost += m;
    }
    if (!ok) continue;
    const score = n * 100 + phrase.tokens.join("").length - cost * 50;
    const bestScore = best ? (best.end - best.start) * 100 + best.phrase.tokens.join("").length - best.cost * 50 : -Infinity;
    if (score > bestScore) best = { phrase, start: i, end: i + n, cost };
  }
  return best;
}

const isNumber = (t: string) => /^\d+(\.\d+)?$/.test(t);

function negatedBefore(tokens: string[], start: number): boolean {
  for (let k = Math.max(0, start - 2); k < start; k++) {
    if (NEGATION_TOKENS.includes(tokens[k])) return true;
  }
  return false;
}

/** "ROSC לאחר החייאה", "מאז השוק": describes what already happened, not an order.
 *  "אחרי" counts only before a definite noun ("אחרי השוק", "אחרי הניטרו"); "אחרי זה" sequences the next order. */
const AFTER_TOKENS = ["לאחר", "מאז", "post"];
const describedBefore = (tokens: string[], start: number) =>
  start > 0 && (AFTER_TOKENS.includes(tokens[start - 1]) || (tokens[start - 1] === "אחרי" && tokens[start].startsWith("ה")));

/** "מוציאה ציוד הנשמה למקרה הצורך", "מכין אטרופין": getting something ready isn't doing it — unless the
 *  same message also gives it ("מכינה אדנוזין ונותנת בפוש"). */
const PREPARE_TOKENS = ["מכין", "מכינה", "להכין", "מכינים", "מוציא", "מוציאה", "להוציא", "מוציאים", "פורק", "פורקת", "לפרוק", "פורקים", "מארגן", "מארגנת", "לארגן", "ציוד", "מוכן", "מוכנה", "בהיכון", "להביא", "מביא", "מביאה", "מביאים", "תביא"];
const GIVE_TOKENS = ["נותן", "נותנת", "לתת", "נותנים", "מזריק", "מזריקה", "להזריק", "מבצע", "מבצעת", "לבצע", "משתמש", "משתמשת", "להשתמש"];
const preparedBefore = (tokens: string[], start: number, end: number) =>
  [start - 1, start - 2].some((k) => k >= 0 && variants(tokens[k]).some((v) => PREPARE_TOKENS.includes(v))) &&
  !tokens.slice(end).some((t) => variants(t).some((v) => GIVE_TOKENS.includes(v)));

/** "שוטפת עם סליין", "20 שטיפה": flushing the line, not a bolus. */
const FLUSH_TOKENS = ["שוטף", "שוטפת", "שטיפה", "לשטוף", "שוטפים", "פלאש", "flush"];
const flushedBefore = (tokens: string[], start: number) =>
  [start - 1, start - 2].some((k) => k >= 0 && variants(tokens[k]).some((v) => FLUSH_TOKENS.includes(v)));

/** "תמרון ולסלבה לא עבד": something that already failed is being talked about, not ordered again. */
const FAILED_TOKENS = ["עבד", "עבדה", "עזר", "עזרה", "הצליח", "הצליחה", "השפיע", "השפיעה", "עוזר", "עוזרת"];
const failedAfter = (tokens: string[], end: number) =>
  tokens.slice(end, end + 3).some((t, k, a) => variants(t).includes("לא") && a[k + 1] !== undefined && FAILED_TOKENS.includes(a[k + 1]));

/** Reads "<number> [unit] [/kg] [/min]" starting at i. */
function readQuantity(tokens: string[], used: boolean[], i: number): { value: number; unit: string | null; end: number } | null {
  if (i >= tokens.length || used[i] || !isNumber(tokens[i])) return null;
  const value = Number(tokens[i]);
  let j = i + 1;
  let unit: string | null = null;
  const u = j < tokens.length ? bestAt(tokens, used, j, UNIT_PHRASES, true) : null;
  if (u) {
    unit = u.phrase.key;
    j = u.end;
  }
  // "/kg", "לק"ג", "/min", "לדקה" in any order after the unit.
  for (let pass = 0; pass < 2 && j < tokens.length; pass++) {
    if (tokens[j] === "/") j++;
    if (j >= tokens.length) break;
    const vs = variants(tokens[j]);
    if (PER_KG_TOKENS.some((k) => vs.includes(k))) {
      unit = `${unit ?? ""}/kg`;
      j++;
    } else if (PER_MIN_TOKENS.some((k) => vs.includes(k))) {
      unit = `${unit ?? ""}/min`;
      j++;
    }
  }
  return { value, unit, end: j };
}

// ---------------------------------------------------------------------------

const TRIGGER_TOKENS = STATEMENT_TRIGGERS.map((w) => tokenize(w)).filter((t) => t.length);

/** Does the text contain the phrase (word by word, forgiving prefixes and small typos)? */
export function mentions(text: string, phrase: string): boolean {
  const tokens = tokenize(text);
  const want = tokenize(phrase);
  if (!want.length) return false;
  for (let i = 0; i + want.length <= tokens.length; i++) {
    if (want.every((w, k) => tokenMatch(tokens[i + k], w) >= 0)) return true;
  }
  return false;
}

function isStatement(clause: string): boolean {
  const tokens = tokenize(clause);
  return TRIGGER_TOKENS.some((want) => {
    for (let i = 0; i + want.length <= tokens.length; i++) {
      if (want.every((w, k) => variants(tokens[i + k]).includes(w))) return true;
    }
    return false;
  });
}

/** Labels of drugs named in the text that aren't in the formulary (exact names only). */
export function notCarried(text: string): string[] {
  const tokens = tokenize(text);
  const used = tokens.map(() => false);
  const ids = new Set<string>();
  for (let i = 0; i < tokens.length; i++) {
    const m = bestAt(tokens, used, i, NOT_CARRIED_PHRASES, true);
    if (m && !negatedBefore(tokens, m.start)) ids.add(m.phrase.key);
  }
  return NOT_CARRIED.filter((d) => ids.has(d.id)).map((d) => d.label);
}

/** "מדווחת על בת 50 לאחר SVT, הפך עם אדנוזין": after a report verb and "על", the rest is the report's
 *  content — recorded like a diagnosis, not acted on. */
const REPORT = /(^|[\s,])(ו?(?:מדווח|מדווחת|מדוויח|מדוויחה|מדווחים|לדווח|מעדכן|מעדכנת))\s+(?:\S+\s+){0,3}?(?:על\s+|(?=ש[א-ת]{2,}))/;
/** "...ומפנה מהר" at the end of a report is the next order, not part of the report. */
const REPORT_TAIL = /(?:,\s*(?:לא\s*,?\s*)?((?:ו)?(?:אני\s+)?(?:מפנה|מפנים|מתחיל|מתחילה|מעמיס|מעמיסה|מעמיסים|נוסעים|ממשיך|ממשיכה)(?:\s.*)?)|\s(ו(?:אני\s+)?(?:מפנה|מפנים|מתחיל|מתחילה|מעמיס|מעמיסה|מעמיסים|נוסעים|ממשיך|ממשיכה)(?:\s.*)?))$/;

export function parse(text: string): Parsed {
  const report = REPORT.exec(text);
  if (report) {
    const cut = report.index + report[0].length;
    const head = parseClauses(text.slice(0, cut).replace(/\s+על\s*$/, ""));
    let content = text.slice(cut).trim();
    const tail = REPORT_TAIL.exec(content);
    const after = tail ? parseClauses(tail[1] ?? tail[2]) : null;
    if (tail) content = content.slice(0, tail.index).trim();
    const statements = [...head.statements, ...(content ? [content] : []), ...(after?.statements ?? [])];
    if (!after) return { ...head, statements };
    return {
      items: [...head.items, ...after.items],
      negated: [...head.negated, ...after.negated],
      prepared: [...head.prepared, ...after.prepared],
      planned: [...head.planned, ...after.planned],
      flush: head.flush || after.flush,
      bare: head.bare ?? after.bare,
      statements,
    };
  }
  return parseClauses(text);
}

function parseClauses(text: string): Parsed {
  // Diagnosis clauses are split off first, so "חושדת בבצקת ריאות" isn't read as "check for edema".
  // Split on punctuation, but not inside numbers ("0.4", "0,5").
  const clauses = text.split(/[;\n]+|[.,](?!\d)/).map((c) => c.trim()).filter(Boolean);
  const statements = clauses.filter(isStatement);
  // Questions ("מתי נתתם ונטולין?") are parsed on their own and only ask, look or measure; the other
  // clauses are read together, so a dose in the next clause still belongs to its drug.
  const out: Omit<Parsed, "statements"> = { items: [], negated: [], bare: null, prepared: [], planned: [], flush: false };
  let buffer: string[] = [];
  const flush = () => {
    if (!buffer.length) return;
    const r = parseItems(buffer.join(", "));
    out.items.push(...r.items);
    out.negated.push(...r.negated);
    out.prepared.push(...r.prepared);
    out.flush ||= r.flush;
    out.bare ??= r.bare;
    buffer = [];
  };
  for (const clause of clauses.filter((c) => !isStatement(c))) {
    // From "אם" / "לפני ש" / "למקרה ש" to the end of the clause is a plan: look and ask, but don't treat.
    const h = HYPOTHETICAL.exec(clause);
    const c = h ? clause.slice(0, h.index).trim() : clause;
    if (c) {
      if (!isQuestion(c)) buffer.push(c);
      else {
        flush();
        const r = parseItems(c);
        out.items.push(...questionItems(r.items));
        out.negated.push(...r.negated);
      }
    }
    if (h) {
      flush();
      const r = parseItems(clause.slice(h.index));
      out.items.push(...r.items.filter((it) => it.kind === "action" && ASK_OR_EXAM.has(it.id)));
      out.planned.push(...r.items.filter((it) => !(it.kind === "action" && ASK_OR_EXAM.has(it.id))).map((it) => (it.kind === "drug" ? it.drug : it.id)));
      out.negated.push(...r.negated);
    }
  }
  flush();
  return { ...out, statements };
}

/** Where a plan starts: "אם"/"ואם" (if), "לפני ש..." (before I...), "למקרה ש"/"במקרה ש" (in case). Not "שואלת אם" (whether). */
const HYPOTHETICAL = /(?:^|\s)(?<!(?:שואל|שואלת|לשאול|בודק|בודקת|לבדוק)\s)(?:ו?אם|ו?לפני\s+ש\S*|ו?(?:ל|ב)מקרה\s+ש\S*)(?=\s|$)/;

const QUESTION_WORDS = ["מתי", "ממתי", "האם", "כמה", "איזה", "איזו", "אילו", "למה", "מדוע", "באיזה", "באיזו", "מה", "איך", "איפה", "היכן"];

/** A clause asking something: ends with "?" or starts with a question word. */
function isQuestion(clause: string): boolean {
  if (/[?؟]\s*$/.test(clause)) return true;
  const first = tokenize(clause)[0];
  // "ומה המרחק לבית החולים" — with a prefix letter too.
  return first !== undefined && (QUESTION_WORDS.includes(first) || (first.startsWith("ו") && QUESTION_WORDS.includes(first.slice(1))));
}

/** A question never gives a drug or does a treatment; naming a drug in one asks about medications. */
function questionItems(items: ParsedItem[]): ParsedItem[] {
  let kept = items.filter((it) => it.kind === "action" && ASK_OR_EXAM.has(it.id));
  const askedDrug = items.some((it) => it.kind === "drug");
  const bareWhen = (it: ParsedItem) => it.kind === "action" && it.id === "askOnset" && it.phrase === "מתי";
  if (askedDrug && !kept.some((it) => it.kind === "action" && it.id.startsWith("ask") && !bareWhen(it))) {
    kept.push({ kind: "action", id: "askMeds", phrase: "" });
  }
  // A bare "מתי" is only the onset question when nothing more specific was asked ("מתי אכלת לאחרונה?").
  if (kept.some((it) => it.kind === "action" && it.id !== "askOnset" && it.id.startsWith("ask"))) {
    kept = kept.filter((it) => !bareWhen(it));
  }
  return kept;
}

function parseItems(text: string): Omit<Parsed, "statements"> {
  const tokens = tokenize(text);
  const used = tokens.map(() => false);
  const found: { pos: number; item: ParsedItem }[] = [];
  const negated: string[] = [];
  const prepared: string[] = [];
  let flush = false;
  const mark = (a: number, b: number) => {
    for (let k = a; k < b; k++) used[k] = true;
  };

  // Pass 1: drugs and their dose / unit / route.
  for (let i = 0; i < tokens.length; i++) {
    const m = bestAt(tokens, used, i, DRUG_PHRASES);
    if (!m) continue;
    // A typo-match on a drug never beats an exact action ("ניטור" isn't "ניטרו").
    if (m.cost > 0 && bestAt(tokens, used, i, ACTION_PHRASES)?.cost === 0) continue;
    mark(m.start, m.end);
    if (negatedBefore(tokens, m.start)) {
      negated.push(m.phrase.key);
      i = m.end - 1;
      continue;
    }
    if (describedBefore(tokens, m.start) || failedAfter(tokens, m.end)) {
      i = m.end - 1;
      continue;
    }
    if (preparedBefore(tokens, m.start, m.end)) {
      prepared.push(m.phrase.key);
      i = m.end - 1;
      continue;
    }
    if (m.phrase.key === "saline" && flushedBefore(tokens, m.start)) {
      flush = true;
      i = m.end - 1;
      continue;
    }
    let value: number | null = null;
    let unit: string | null = null;
    let route: string | null = null;
    // Look ahead a few tokens, stopping at the next drug.
    for (let j = m.end; j < Math.min(tokens.length, m.end + 8); j++) {
      if (used[j]) continue;
      if (bestAt(tokens, used, j, DRUG_PHRASES)?.cost === 0) break;
      if (value === null) {
        const q = readQuantity(tokens, used, j);
        if (q) {
          value = q.value;
          unit = q.unit;
          mark(j, q.end);
          j = q.end - 1;
          // "0.01 לקילו זה 0.2 מג": the worked-out dose that follows the per-kg figure is what's given.
          const next = !q.unit || q.unit.startsWith("/") ? readQuantity(tokens, used, q.end) : null;
          if (next?.unit && !next.unit.startsWith("/")) {
            value = next.value;
            unit = next.unit;
            mark(q.end, next.end);
            j = next.end - 1;
          }
          continue;
        }
      }
      {
        // A second route word belongs to the same drug ("לשריר בירך"), not to another action.
        const r = bestAt(tokens, used, j, ROUTE_PHRASES, true);
        if (r) {
          route ??= r.phrase.key;
          mark(r.start, r.end);
          j = r.end - 1;
          continue;
        }
      }
      // The next action starts here ("אדנוזין ואק"ג 12" — the 12 isn't a dose).
      if (bestAt(tokens, used, j, ACTION_PHRASES)?.cost === 0) break;
    }
    if (unit?.startsWith("/")) unit = (DRUGS.find((d) => d.id === m.phrase.key)?.unit ?? "") + unit;
    // "300 מג אספירין": quantity written before the drug.
    if (value === null) {
      for (let j = Math.max(0, m.start - 4); j < m.start; j++) {
        const q = readQuantity(tokens, used, j);
        if (q && q.end === m.start) {
          value = q.value;
          unit = q.unit;
          mark(j, q.end);
          break;
        }
      }
    }
    // "בשאיפה ונטולין", "IV אדרנלין": route written before the drug.
    if (route === null) {
      for (let j = Math.max(0, m.start - 2); j < m.start; j++) {
        if (used[j]) continue;
        const r = bestAt(tokens, used, j, ROUTE_PHRASES, true);
        if (r && r.end <= m.start) {
          route = r.phrase.key;
          mark(r.start, r.end);
          break;
        }
      }
    }
    found.push({ pos: m.start, item: { kind: "drug", drug: m.phrase.key, value, unit, route, phrase: m.phrase.text } });
    i = m.end - 1;
  }

  // Pass 2: actions on what's left.
  for (let i = 0; i < tokens.length; i++) {
    if (used[i]) continue;
    const m = bestAt(tokens, used, i, ACTION_PHRASES);
    if (!m) continue;
    mark(m.start, m.end);
    if (negatedBefore(tokens, m.start)) {
      negated.push(m.phrase.key);
      i = m.end - 1;
      continue;
    }
    if (describedBefore(tokens, m.start) || failedAfter(tokens, m.end)) {
      i = m.end - 1;
      continue;
    }
    if (preparedBefore(tokens, m.start, m.end)) {
      prepared.push(m.phrase.key);
      i = m.end - 1;
      continue;
    }
    const item: ParsedItem = { kind: "action", id: m.phrase.key, phrase: m.phrase.text };
    if (m.phrase.key === "shock" || m.phrase.key === "sync") {
      // Energy right after ("שוק 200") or right before ("200 גאול שוק").
      for (const j of [m.end, m.end + 1, m.start - 2, m.start - 1]) {
        const q = j >= 0 ? readQuantity(tokens, used, j) : null;
        if (q && (q.unit === null || q.unit === "J")) {
          item.joules = q.value;
          mark(j, q.end);
          break;
        }
      }
    }
    found.push({ pos: m.start, item });
    i = m.end - 1;
  }

  // A lone quantity ("300 מג", "200") answers a pending question.
  let bare: Parsed["bare"] = null;
  for (let i = 0; i < tokens.length; i++) {
    const q = readQuantity(tokens, used, i);
    if (q) {
      bare = { value: q.value, unit: q.unit };
      break;
    }
  }

  // "גלוקוז 10% 250 מל": the stated strength turns the volume into grams (tokenize drops the "%").
  const pct = /(\d+(?:\.\d+)?)\s*%/.exec(text);
  if (pct) for (const f of found) if (f.item.kind === "drug" && f.item.drug === "dextrose") f.item.conc = Number(pct[1]) / 100;
  found.sort((a, b) => a.pos - b.pos);
  // "הנשמה במפוח" names one action twice.
  const items = found
    .map((f) => f.item)
    // "נוטל תרופות לאין־אונות?" is the PDE5 question, not the medication list ("לוקחת תרופות" still is).
    .filter((it, _k, all) => !(it.kind === "action" && it.id === "askMeds" && it.phrase === "תרופות" && all.some((o) => o.kind === "action" && (o.id === "askPde5" || o.id === "askAllergies"))))
    .filter((it, k, all) => it.kind === "drug" || all.findIndex((o) => o.kind === "action" && o.id === it.id) === k);
  return { items, bare, negated, prepared, planned: [], flush };
}
