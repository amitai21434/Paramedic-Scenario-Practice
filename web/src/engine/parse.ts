// Free text → ordered list of actions and drug administrations.
//
// No AI: the text is normalized, split into tokens, and matched against the
// lexicon. Drugs are matched first and take the dose/unit/route words that
// follow them, so "אדרנלין 1 מג IV" doesn't also read as "open an IV".

import { ACTIONS, DRUGS, NEGATIONS, NOT_CARRIED, PER_KG, PER_MIN, ROUTES, STATEMENT_TRIGGERS, STOPWORDS, UNITS } from "./lexicon";

export type ParsedItem =
  | { kind: "action"; id: string; joules?: number; phrase: string; withBag?: boolean }
  | { kind: "drug"; drug: string; value: number | null; unit: string | null; route: string | null; phrase: string };

export type Parsed = {
  items: ParsedItem[];
  /** Clauses stating a diagnosis or ECG reading — recorded, not acted on. */
  statements: string[];
  /** A number (with optional unit) that wasn't attached to anything — answers "what dose?". */
  bare: { value: number; unit: string | null } | null;
  negated: string[];
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
const NO_TYPO = new Set(["מושיב", "מושיבה", "שואב", "שואבת", "שאיבה", "שטיפה", "מיגון", "לוחץ", "הכרת", "מזעזע", "דקסטרו", "סוכרת", "סכרת", "ישיבה", "בחילה", "בחילות", "איירווי", "טבעות", "קשירה", "קושרת", "ריסון", "מרגיע", "מרגיעה", "חימום", "דימום"].map(normalize));

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
 *  (Colloquial "אחרי (זה)" is left alone: it usually sequences the next order.) */
const AFTER_TOKENS = ["לאחר", "מאז", "post"];
const describedBefore = (tokens: string[], start: number) => start > 0 && AFTER_TOKENS.includes(tokens[start - 1]);

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

export function parse(text: string): Parsed {
  // Diagnosis clauses are split off first, so "חושדת בבצקת ריאות" isn't read as "check for edema".
  // Split on punctuation, but not inside numbers ("0.4", "0,5").
  const clauses = text.split(/[;\n]+|[.,](?!\d)/).map((c) => c.trim()).filter(Boolean);
  const statements = clauses.filter(isStatement);
  const rest = clauses.filter((c) => !isStatement(c)).join(", ");
  return { ...parseItems(rest), statements };
}

function parseItems(text: string): Omit<Parsed, "statements"> {
  const tokens = tokenize(text);
  const used = tokens.map(() => false);
  const found: { pos: number; item: ParsedItem }[] = [];
  const negated: string[] = [];
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
    if (describedBefore(tokens, m.start)) {
      i = m.end - 1;
      continue;
    }
    let value: number | null = null;
    let unit: string | null = null;
    let route: string | null = null;
    // Look ahead a few tokens, stopping at the next drug.
    for (let j = m.end; j < Math.min(tokens.length, m.end + 6); j++) {
      if (used[j]) continue;
      if (bestAt(tokens, used, j, DRUG_PHRASES)?.cost === 0) break;
      if (value === null) {
        const q = readQuantity(tokens, used, j);
        if (q) {
          value = q.value;
          unit = q.unit;
          mark(j, q.end);
          j = q.end - 1;
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
    if (describedBefore(tokens, m.start)) {
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

  found.sort((a, b) => a.pos - b.pos);
  // "הנשמה במפוח" names one action twice.
  const items = found
    .map((f) => f.item)
    // "נוטל תרופות לאין־אונות?" is the PDE5 question, not the medication list.
    .filter((it, _k, all) => !(it.kind === "action" && it.id === "askMeds" && all.some((o) => o.kind === "action" && (o.id === "askPde5" || o.id === "askAllergies"))))
    .filter((it, k, all) => it.kind === "drug" || all.findIndex((o) => o.kind === "action" && o.id === it.id) === k);
  return { items, bare, negated };
}
