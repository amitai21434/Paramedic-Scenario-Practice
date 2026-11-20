// Free text → ordered list of actions and drug administrations.
//
// No AI: the text is normalized, split into tokens, and matched against the
// lexicon. Drugs are matched first and take the dose/unit/route words that
// follow them, so "אדרנלין 1 מג IV" doesn't also read as "open an IV".

import { ACTIONS, ASK_OR_EXAM, DRUGS, NEGATIONS, NOT_CARRIED, PER_KG, PER_MIN, RHYTHM_NAMES, ROUTES, STATEMENT_TRIGGERS, STOPWORDS, UNITS } from "./lexicon";

export type ParsedItem =
  | { kind: "action"; id: string; joules?: number; joulesPerKg?: boolean; phrase: string; withBag?: boolean }
  | { kind: "drug"; drug: string; value: number | null; unit: string | null; route: string | null; phrase: string; conc?: number; range?: boolean };

export type Parsed = {
  items: ParsedItem[];
  /** Clauses stating a diagnosis or ECG reading — recorded, not acted on. */
  statements: string[];
  /** A number (with optional unit) that wasn't attached to anything — answers "what dose?". */
  bare: { value: number; unit: string | null; route?: string | null } | null;
  negated: string[];
  /** Actions or drugs only got ready ("מוציאה ציוד הנשמה", "מכינה אדנוזין") — not done. */
  prepared: string[];
  /** Treatments only planned ("אם נמוך אתן גלוקוז", "לפני שאני נותנת ניטרו...") — not done. */
  planned: string[];
  /** The IV line was flushed ("שוטפת עם סליין") — not a fluid bolus. */
  flush: boolean;
  /** Drugs whose contraindications were checked ("קונטרה אינדיקציות לניטרט") — a dose may follow. */
  contra?: string[];
  /** Drugs drawn up with their dose ("שאיבת קטמין 100 מג") — given later. */
  preparedDrugs?: { drug: string; value: number | null; unit: string | null; route: string | null }[];
  /** Things stopped ("הפסק אמבו", "הפסקת הרטמן"): action or drug ids. */
  stopped?: string[];
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
  // ("GCS15" is the score after the name.)
  const norm = normalize(text).replace(/\d+(?:[.,]\d+)?\s*%/g, " ").replace(/gcs(?=\d)/g, "gcs ");
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
const NO_TYPO = new Set(["מושיב", "מושיבה", "שואב", "שואבת", "שאיבה", "שטיפה", "מיגון", "לוחץ", "הכרת", "מזעזע", "דקסטרו", "סוכרת", "סכרת", "ישיבה", "בחילה", "בחילות", "איירווי", "טבעות", "קשירה", "קושרת", "ריסון", "מרגיע", "מרגיעה", "חימום", "דימום", "משטרה", "עטיפה", "עוטף", "עוטפת", "נושם", "נושמת", "מדדים", "שוקל", "שוקלת", "ריאות", "לריאות", "מוצץ", "מוצצת", "מציצה", "מגיב", "מגיבה", "אוושה", "אוושות", "אקמול", "ימניים", "ימנים", "עיניים", "עינים", "פינוי", "שינוי", "קיבוע", "תלונות", "תלונה",
  // "שמירה" isn't "שמיכה", "כיסוי" isn't "כיבוי", "כליות"/"כריות" aren't "כוויות", "אישור" isn't "אישון", "אמבולנס" isn't "לאמבולנס".
  "שמיכה", "כיבוי", "כוויות", "כוויה", "כריות", "אישון", "לאמבולנס"].map(normalize));

/** Exact only, not even a sound-alike swap: "אוושה" is one swap from "עושה" (doing), "משיכה" from "מסיכה" (mask).
 *  Ending the scenario never happens on a typo ("מסיכת", "מסייעת" are not "מסיימת"). */
const STRICT = new Set(["אוושה", "אוושות", "משיכה", "סיום", "מסיים", "מסיימת", "הגענו", "סוף"].map(normalize));

/** 0 = exact, 0.5 = sound-alike letter swap, 1 = other typo, -1 = no match. */
function tokenMatch(input: string, word: string): number {
  const vs = variants(input);
  if (vs.includes(word)) return 0;
  if (/^\d/.test(word) || STRICT.has(word)) return -1;
  // A sound-alike letter swap ("שליין", "דיווכ", "משקיבה", "עקמול") is the likeliest typo — allowed even for
  // the protected words below, whose danger is a near-miss with a *different* word; short words ("סלין",
  // "דיוח" after normalizing) accept only that.
  if (word.length >= 4 && vs.some((v) => soundAlike(v, word))) return 0.5;
  if (NO_TYPO.has(word)) return -1;
  if (word.length < 5) return -1;
  const max = word.length >= 9 ? 2 : 1;
  return vs.some((v) => v.length >= 4 && distance(v, word, max) <= max) ? 1 : -1;
}

/** Letters that are easy to swap when typing by sound. */
const SOUND_ALIKE = new Set(["סש", "שס", "כח", "חכ", "כק", "קכ", "טת", "תט", "אע", "עא"]);
function soundAlike(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) continue;
    if (++diff > 1 || !SOUND_ALIKE.has(a[i] + b[i])) return false;
  }
  return diff === 1;
}

// ---------------------------------------------------------------------------
// Phrase tables
// ---------------------------------------------------------------------------

type Phrase = { key: string; tokens: string[]; text: string };

/** Masculine present verbs → feminine, so "מקבע אגן" also reads "מקבעת אגן" without listing both. */
const FEMININE: Record<string, string> = {
  פותח: "פותחת", נותן: "נותנת", מחבר: "מחברת", בודק: "בודקת", מודד: "מודדת", מושיב: "מושיבה", משכיב: "משכיבה",
  מנשים: "מנשימה", מתחיל: "מתחילה", מקבע: "מקבעת", שואל: "שואלת", מכניס: "מכניסה", מוריד: "מורידה", מרים: "מרימה",
  מזמין: "מזמינה", מבצע: "מבצעת", מקשיב: "מקשיבה", מחמם: "מחממת", מייבש: "מייבשת", שוטף: "שוטפת", מוסיף: "מוסיפה",
  ממשיך: "ממשיכה", חוזר: "חוזרת", מסיר: "מסירה", מתקשר: "מתקשרת", מודיע: "מודיעה", מדווח: "מדווחת", מצמיד: "מצמידה",
  מחדיר: "מחדירה", מזריק: "מזריקה", מאזין: "מאזינה", מעביר: "מעבירה", מפעיל: "מפעילה", מרגיע: "מרגיעה", מטפל: "מטפלת",
  מפסיק: "מפסיקה", מנקז: "מנקזת", מלביש: "מלבישה", מהדק: "מהדקת", לוחץ: "לוחצת", עוטף: "עוטפת", חותך: "חותכת",
  מוציא: "מוציאה", מחזיר: "מחזירה", מושך: "מושכת", תומך: "תומכת", מנטר: "מנטרת", מעמיס: "מעמיסה", מרחיק: "מרחיקה",
  מכין: "מכינה", מצנן: "מצננת", מקרר: "מקררת", מכסה: "מכסה", מעסה: "מעסה", מפנה: "מפנה", שם: "שמה", סופר: "סופרת",
  מעריך: "מעריכה", מסתכל: "מסתכלת", מגן: "מגינה", קושר: "קושרת", מאבטח: "מאבטחת", מייצב: "מייצבת", מזיז: "מזיזה",
};

function compile(entries: { id: string; words: string[] }[]): Phrase[] {
  return entries.flatMap((e) => {
    const words = e.words.flatMap((w) => {
      const [first, ...rest] = w.split(" ");
      const fem = FEMININE[first];
      return fem && !e.words.includes([fem, ...rest].join(" ")) ? [w, [fem, ...rest].join(" ")] : [w];
    });
    return words.map((w) => ({ key: e.id, tokens: tokenize(w), text: w })).filter((p) => p.tokens.length > 0);
  });
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
      // Short words (route/unit abbreviations) must match exactly — or by a sound-alike swap ("בתפטוף").
      const m = exactOnly
        ? variants(tokens[i + k]).includes(phrase.tokens[k])
          ? 0
          : phrase.tokens[k].length >= 4 && variants(tokens[i + k]).some((v) => soundAlike(v, phrase.tokens[k]))
            ? 0.5
            : -1
        : tokenMatch(tokens[i + k], phrase.tokens[k]);
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

/** Words that carry a negation on to the treatment after them: "לא נותנת ניטרו", "אין צורך באינטובציה". */
const NEGATED_VERBS = ["רציתי", "רוצה", "התכוונתי", "נותן", "נותנת", "לתת", "נותנים", "מבצע", "מבצעת", "לבצע", "עושה", "עושים", "לעשות", "צורך", "צריך", "צריכה",
  "מחבר", "מחברת", "לחבר", "פותח", "פותחת", "לפתוח", "מתחיל", "מתחילה", "להתחיל", "ממשיך", "ממשיכה", "להמשיך", "מזריק", "מזריקה", "להזריק"].map(normalize);

function negatedBefore(tokens: string[], start: number): boolean {
  if (start >= 1 && NEGATION_TOKENS.includes(tokens[start - 1])) return true;
  // Two words back only through a verb: "לא נותנת ניטרו" — not "המצב לא משתפר, אדרנלין".
  return start >= 2 && NEGATION_TOKENS.includes(tokens[start - 2]) && variants(tokens[start - 1]).some((v) => NEGATED_VERBS.includes(v));
}

/** "ROSC לאחר החייאה", "מאז השוק": describes what already happened, not an order.
 *  "אחרי" counts only before a definite noun ("אחרי השוק", "אחרי הניטרו"); "אחרי זה" sequences the next order. */
const AFTER_TOKENS = ["לאחר", "מאז", "post"].map(normalize);
const describedBefore = (tokens: string[], start: number) =>
  start > 0 && (AFTER_TOKENS.includes(tokens[start - 1]) || (tokens[start - 1] === "אחרי" && tokens[start].startsWith("ה")));

/** "מוציאה ציוד הנשמה למקרה הצורך", "מכין אטרופין": getting something ready isn't doing it — unless the
 *  same message also gives it ("מכינה אדנוזין ונותנת בפוש"). */
const PREPARE_TOKENS = ["מכין", "מכינה", "להכין", "מכינים", "הכנת", "הכנה", "מוציא", "מוציאה", "להוציא", "מוציאים", "פורק", "פורקת", "לפרוק", "פורקים", "מארגן", "מארגנת", "לארגן", "ציוד", "מוכן", "מוכנה", "בהיכון", "להביא", "מביא", "מביאה", "מביאים", "תביא"].map(normalize);
/** Drawing a drug up ("שאיבת קטמין 100 מג") — for drugs only: "שאיבה" alone is suction. */
const DRAW_TOKENS = ["שאיבת", "שאיבה", "שואב", "שואבת", "לשאוב", "שואבים"].map(normalize);
/** Charging the defibrillator ("טעינת שוק 26 ג'ול") — for shocks only. */
const CHARGE_TOKENS = ["טעינת", "טעינה", "טוען", "טוענת", "לטעון", "טוענים"].map(normalize);
const GIVE_TOKENS = ["נותן", "נותנת", "לתת", "נותנים", "מזריק", "מזריקה", "להזריק", "מבצע", "מבצעת", "לבצע", "משתמש", "משתמשת", "להשתמש"].map(normalize);
const RANGE = tokenize("טווחמינון")[0];
const isUnitWord = (t: string) => UNIT_PHRASES.some((p) => p.tokens.length === 1 && variants(t).includes(p.tokens[0])) || PER_KG_TOKENS.some((k) => variants(t).includes(k));
/** Where the "getting it ready" word is, up to two words before the item (a dose in between doesn't count:
 *  "שאיבה של 5.6 מג אטומידאט") — or -1, also when the same message gives it ("מכינה אדנוזין ונותנת בפוש"). */
function preparedAt(tokens: string[], start: number, end: number, extra: string[] = []): number {
  if (tokens.slice(end).some((t) => variants(t).some((v) => GIVE_TOKENS.includes(v)))) return -1;
  for (let k = start - 1, words = 0; k >= 0 && words < 2; k--) {
    if (isNumber(tokens[k]) || isUnitWord(tokens[k])) continue;
    if (variants(tokens[k]).some((v) => PREPARE_TOKENS.includes(v) || extra.includes(v))) return k;
    words++;
  }
  return -1;
}

/** "שוטפת עם סליין", "20 שטיפה": flushing the line, not a bolus. */
const FLUSH_TOKENS = ["שוטף", "שוטפת", "שטיפה", "לשטוף", "שוטפים", "פלאש", "flush"].map(normalize);
const flushedBefore = (tokens: string[], start: number) =>
  [start - 1, start - 2].some((k) => k >= 0 && variants(tokens[k]).some((v) => FLUSH_TOKENS.includes(v)));

/** "איזוקט 2 מג מהול ב־4 סליין": the saline a drug is diluted in isn't a fluid order. */
const DILUTE_TOKENS = ["מהול", "מהולה", "מהולים", "מיהול", "במיהול", "לדלל", "מדולל", "מדוללת", "מדלל", "מדללת"].map(normalize);

/** "הפסק אמבו", "הפסקת הרטמן", "ביטול קוצב", "להסיר חמצן": stopping something, not starting it. */
const STOP_TOKENS = ["הפסק", "הפסקת", "להפסיק", "מפסיק", "מפסיקה", "מפסיקים", "עצירת", "עצור", "עוצר", "עוצרת", "לעצור", "ביטול", "בטול", "מבטל", "מבטלת", "לבטל", "בטל", "הסרת", "להסיר", "מסיר", "מסירה", "הורדת", "להוריד", "מוריד", "מורידה"].map(normalize);
/** What stopping these is called in the lexicon. */
const STOP_AS: Record<string, string> = { cpr: "cprStop", lucas: "cprStop", o2: "o2Stop" };

/** "חמש מיליגרם", "אחד גרם": a number written as a word, before a unit. */
const NUMBER_WORDS: Record<string, number> = Object.fromEntries(
  Object.entries({ אחד: 1, אחת: 1, שניים: 2, שתיים: 2, שני: 2, שתי: 2, שלוש: 3, שלושה: 3, ארבע: 4, ארבעה: 4, חמש: 5, חמישה: 5, שש: 6, שישה: 6, שבע: 7, שבעה: 7, שמונה: 8, תשע: 9, תשעה: 9, עשר: 10, עשרה: 10, חצי: 0.5 }).map(([w, n]) => [normalize(w), n]),
);

/** "קונטרה אינדיקציות לניטרט", "התוויות נגד לאדנוזין". */
const CONTRA_TOKENS = ["קונטרה", "קונטראינדיקציות", "קונטרהאינדיקציות", "התוויות", "התויות", "אינדיקציות"].map(normalize);
const contraBefore = (tokens: string[], start: number) =>
  [start - 1, start - 2, start - 3].some((k) => k >= 0 && variants(tokens[k]).some((v) => CONTRA_TOKENS.includes(v)));
/** Drugs measured by volume. */
const VOLUME_DRUGS = ["saline"];

/** "תמרון ולסלבה לא עבד": something that already failed is being talked about, not ordered again. */
const FAILED_TOKENS = ["עבד", "עבדה", "עזר", "עזרה", "הצליח", "הצליחה", "השפיע", "השפיעה", "עוזר", "עוזרת"].map(normalize);
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

/** Words that only grade a diagnosis ("אסטמה קשה", "פרפור עליות חדש"). */
const GRADES = ["קשה", "קלה", "קל", "בינונית", "בינוני", "חמורה", "חמור", "חדש", "חדשה", "חריף", "חריפה", "כרוני", "כרונית", "מהיר", "איטי"].map(normalize);

/** Is the text just this name, word for word (typos forgiven), maybe with a grade after it? */
const NAME_TOKENS = new Map<string, string[]>();
export function namesExactly(text: string, name: string): boolean {
  let tokens = tokenize(text);
  let want = NAME_TOKENS.get(name);
  if (!want) NAME_TOKENS.set(name, (want = tokenize(name)));
  // ("פרפור איטי" is a name of its own; "אסטמה קשה" is asthma, graded.)
  while (tokens.length > want.length && GRADES.includes(tokens.at(-1)!)) tokens = tokens.slice(0, -1);
  if (want.length !== tokens.length) return false;
  return want.length > 0 && tokens.length === want.length && want.every((w, k) => tokenMatch(tokens[k], w) >= 0);
}

/** Is the whole text one action, word for word ("מקצב" is a rhythm check, never the rhythm "מקוצב")? */
export function isExactAction(text: string): boolean {
  const tokens = tokenize(text);
  const m = tokens.length ? bestAt(tokens, tokens.map(() => false), 0, ACTION_PHRASES) : null;
  return m !== null && m.cost === 0 && m.end === tokens.length;
}

const RHYTHM_WORDS = Object.values(RHYTHM_NAMES).flatMap((r) => r.words);
const isRhythmName = (clause: string) => !isExactAction(clause) && RHYTHM_WORDS.some((w) => namesExactly(clause, w));

/** "שוק נוירוגני", "בהלם ספטי": the kind of shock is a diagnosis — never a defibrillation. */
const SHOCK_KIND = /(^|\s)[וב]?(?:שוק|הלם)\s+(?:נוירוגני|נוירוגנית|ספטי|ספטית|היפו\S*|תת\s*נפחי|אנ?אפילקט\S*|קרדיוגני|קרדיוגנית|המורגי|המורגית|דיסטריבוטיבי|חסימתי|אובסטרוקטיבי)/;

/** Where a diagnosis starts in the clause (its trigger word), or -1. */
function statementStart(clause: string): number {
  const kind = SHOCK_KIND.exec(clause);
  if (kind) return kind.index + kind[1].length;
  const words = clause.split(/\s+/);
  let pos = 0;
  for (let j = 0; j < words.length; j++) {
    const rest = words.slice(j).join(" ");
    const tokens = tokenize(rest);
    if (tokens.length && TRIGGER_TOKENS.some((want) => want.every((w, k) => tokens[k] !== undefined && variants(tokens[k]).includes(w)))) {
      return clause.indexOf(words[j], pos);
    }
    pos = clause.indexOf(words[j], pos) + words[j].length;
  }
  return -1;
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
/** "..., ומטחילה פינוי": a report's last comma-clause that mentions transport (even misspelled) is an order. */
const REPORT_TRANSPORT = /,\s*((?:ו)?[^,]*(?:פינוי|מפנה|מפנים|נוסעים|מעמיס|לאמבולנס)[^,]*)$/;
/** "...ומפנה מהר" at the end of a report is the next order, not part of the report. */
const REPORT_TAIL = /(?:,\s*(?:לא\s*,?\s*)?((?:ו)?(?:אני\s+)?(?:מפנה|מפנים|מתחיל|מתחילה|מעמיס|מעמיסה|מעמיסים|נוסעים|ממשיך|ממשיכה)(?:\s.*)?)|\s(ו(?:אני\s+)?(?:מפנה|מפנים|מתחיל|מתחילה|מעמיס|מעמיסה|מעמיסים|נוסעים|ממשיך|ממשיכה)(?:\s.*)?))$/;

function parseText(text: string): Parsed {
  // "אחרי זה החייאה" sequences the next order ("זה" is dropped as filler, which would leave "אחרי החייאה").
  text = text.replace(/(^|\s)ו?אחרי\s+זה(?=\s|,|$)/g, "$1ואז");
  const report = REPORT.exec(text);
  if (report) {
    const cut = report.index + report[0].length;
    const head = parseClauses(text.slice(0, cut).replace(/\s+על\s*$/, ""));
    let content = text.slice(cut).trim();
    const tail = REPORT_TAIL.exec(content) ?? REPORT_TRANSPORT.exec(content);
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
      preparedDrugs: [...(head.preparedDrugs ?? []), ...(after.preparedDrugs ?? [])],
      stopped: [...(head.stopped ?? []), ...(after.stopped ?? [])],
      statements,
    };
  }
  return parseClauses(text);
}

/** Hebrew typed with the keyboard left on English ("cyhju, vfrv" = "בטיחות, הכרה"). */
const HEBREW_KEYS: Record<string, string> = {
  q: "/", w: "'", e: "ק", r: "ר", t: "א", y: "ט", u: "ו", i: "ן", o: "ם", p: "פ", a: "ש", s: "ד", d: "ג", f: "כ", g: "ע", h: "י",
  j: "ח", k: "ל", l: "ך", ";": "ף", ",": "ת", ".": "ץ", z: "ז", x: "ס", c: "ב", v: "ה", b: "נ", n: "מ", m: "צ",
};
/** Every Latin word the lexicon knows (IV, mg, cpap…): those are meant in English. */
const LATIN_WORDS = new Set(
  [...ACTIONS, ...DRUGS, ...NOT_CARRIED].flatMap((e) => e.words)
    .concat(Object.values(ROUTES).flat(), Object.values(UNITS).flat(), PER_KG, PER_MIN, STATEMENT_TRIGGERS, Object.values(RHYTHM_NAMES).flatMap((r) => r.words))
    .flatMap((w) => tokenize(w))
    .filter((t) => /^[a-z]/.test(t)),
);

/** Reads the message; if it has Latin words the lexicon doesn't know, also as Hebrew typed on an English
 *  keyboard — and keeps whichever reading understood more. */
export function parse(text: string): Parsed {
  const plain = parseText(text);
  if (!/[a-z]{2}/i.test(text)) return plain;
  let changed = false;
  const swapped = text.replace(/[a-z][a-z,.;]*/gi, (w) => {
    const word = w.toLowerCase().replace(/[,.;]+$/, "");
    if (LATIN_WORDS.has(word) || word.length < 2) return w;
    changed = true;
    return [...w.toLowerCase()].map((ch) => HEBREW_KEYS[ch] ?? ch).join("");
  });
  if (!changed) return plain;
  const alt = parseText(swapped);
  const size = (p: Parsed) => p.items.length + p.statements.length + p.prepared.length;
  return size(alt) > size(plain) ? alt : plain;
}

function parseClauses(text: string): Parsed {
  // Diagnosis clauses are split off first, so "חושדת בבצקת ריאות" isn't read as "check for edema".
  // Split on punctuation, but not inside numbers ("0.4", "0,5").
  // "?" ends a clause too, and stays with it ("מה קרה? פותחת וריד").
  const raw = text.split(/[;\n]+|[.,](?!\d)|(?<=\?)/).map((c) => c.trim()).filter(Boolean);
  // A diagnosis starts at its trigger; what comes before it ("מוניטור, ואז הקצב הוא סינוס") is still an order.
  const clauses: string[] = [];
  const statements: string[] = [];
  for (const c of raw) {
    // A clause that only names a rhythm ("אסיסטולה. המשך החייאה") is a reading, too.
    if (isRhythmName(c)) {
      statements.push(c);
      continue;
    }
    const at = statementStart(c);
    if (at < 0) clauses.push(c);
    else {
      if (c.slice(0, at).trim()) clauses.push(c.slice(0, at).trim());
      statements.push(c.slice(at).trim());
    }
  }
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
    if (r.contra?.length) out.contra = [...(out.contra ?? []), ...r.contra];
    out.preparedDrugs = [...(out.preparedDrugs ?? []), ...(r.preparedDrugs ?? [])];
    out.stopped = [...(out.stopped ?? []), ...(r.stopped ?? [])];
    out.bare ??= r.bare;
    buffer = [];
  };
  const ask = (seg: string, strict: boolean) => {
    flush();
    const r = parseItems(seg);
    out.items.push(...questionItems(r.items, !strict));
    out.negated.push(...r.negated);
  };
  const handle = (clause: string) => {
    // A plan — from "אם" / "לפני ש" / "למקרה ש" to the next "ואני / ועכשיו / ואז" — looks and asks but doesn't treat.
    const h = HYPOTHETICAL.exec(clause);
    if (h) {
      const tail = clause.slice(h.index + 1);
      const end = PLAN_END.exec(tail);
      const stop = end ? h.index + 1 + end.index : clause.length;
      if (clause.slice(0, h.index).trim()) handle(clause.slice(0, h.index).trim());
      flush();
      const r = parseItems(clause.slice(h.index, stop));
      out.items.push(...r.items.filter((it) => it.kind === "action" && ASK_OR_EXAM.has(it.id)));
      out.planned.push(...r.items.filter((it) => !(it.kind === "action" && ASK_OR_EXAM.has(it.id))).map((it) => (it.kind === "drug" ? it.drug : it.id)));
      out.negated.push(...r.negated);
      if (clause.slice(stop).trim()) handle(clause.slice(stop).trim());
      return;
    }
    if (!isQuestion(clause)) {
      buffer.push(clause);
      return;
    }
    // A question and an order in one clause ("איך אתה מרגיש וחמצן", "זופרן 4 מג וכמה כואב עכשיו?"):
    // only the asking part is a question. "מתי נתתם ונטולין?" only asks; "חמצן, ויש אלרגיות?" still gives the oxygen.
    // "האם יש סיפור של הרדמה והנשמה בעבר": a question about the past is one question, "ו" and all.
    if (startsWithQuestionWord(clause) && PAST.test(clause)) return ask(clause, true);
    const segs = splitOnAnd(clause);
    segs.forEach((seg, i) => {
      if (startsWithQuestionWord(seg)) ask(seg, true);
      else if (i === segs.length - 1 && /[?؟]\s*$/.test(seg)) ask(seg, false);
      else buffer.push(seg);
    });
  };
  for (const clause of clauses) handle(clause);
  flush();
  // Across clauses too: "יש דופק? אני בודקת דופק" is one pulse check (decompressions and shocks can repeat).
  out.items = out.items.filter((it, k, all) => it.kind === "drug" || REPEATABLE.includes(it.id) || all.findIndex((o) => o.kind === "action" && o.id === it.id) === k);
  return { ...out, statements };
}

/** Words that make a question about the past ("היה לו … בעבר?"). */
const PAST = /בעבר|באבר|אי פעם|סיפור של|היסטוריה של/;

/** Actions that are really done twice when named twice ("ניקור חזה, וניקור בצד השני"). */
const REPEATABLE = ["needle", "shock", "sync"];

/** Where a plan starts: "אם"/"ואם" (if), "לפני ש..." (before I...), "למקרה ש"/"במקרה ש" (in case). Not "שואלת אם" (whether). */
const HYPOTHETICAL = /(?:^|\s)(?<!(?:שואל|שואלת|לשאול|בודק|בודקת|לבדוק)\s)(?:ו?אם|ו?לפני\s+ש\S*|ו?(?:ל|ב)מקרה\s+ש\S*)(?=\s|$)/;

/** Where a plan ends: the next order ("...אני שמה חגורת אגן ואני מדווחת"). */
const PLAN_END = /\s+(?:ואני|ועכשיו|ואז|ואחרי)(?=\s)/;

/** Words whose first "ו" is part of the word, not "and" (ונטולין, וריד, ויאגרה, ולסלבה — typos included). */
const VAV_TOKENS = [...new Set([...ACTION_PHRASES, ...DRUG_PHRASES].flatMap((p) => p.tokens).filter((t) => t.startsWith("ו")))];

/** Splits a clause before each "ו…" that means "and". */
function splitOnAnd(clause: string): string[] {
  const words = clause.split(/\s+/);
  const segs: string[][] = [[]];
  for (const w of words) {
    const t = tokenize(w)[0];
    const isAnd = segs.at(-1)!.length > 0 && t !== undefined && t.startsWith("ו") && t.length > 2 && !VAV_TOKENS.some((lt) => lt === t || tokenMatch(t, lt) > 0);
    if (isAnd) segs.push([]);
    segs.at(-1)!.push(w);
  }
  return segs.map((x) => x.join(" ")).filter(Boolean);
}

const QUESTION_WORDS = ["העם", "מתי", "ממתי", "האם", "כמה", "איזה", "איזו", "אילו", "למה", "מדוע", "באיזה", "באיזו", "מה", "איך", "איפה", "היכן"].map(normalize);

/** A clause asking something: ends with "?" or starts with a question word. */
function isQuestion(clause: string): boolean {
  return /[?؟]\s*$/.test(clause) || startsWithQuestionWord(clause);
}

/** "שואלת אותו למה הזמין מד"א": a clause that opens with "I ask" is a question, whatever follows. */
const ASK_VERBS = ["שואל", "שואלת", "לשאול", "שואלים", "מברר", "מבררת", "לברר"].map(normalize);

function startsWithQuestionWord(clause: string): boolean {
  const first = tokenize(clause)[0];
  // "ומה המרחק לבית החולים" — with a prefix letter too.
  return first !== undefined && [first, ...(first.startsWith("ו") ? [first.slice(1)] : [])].some((w) => QUESTION_WORDS.includes(w) || ASK_VERBS.includes(w));
}

/** A question never gives a drug or does a treatment; naming a drug in one asks about medications. */
function questionItems(items: ParsedItem[], keepActions = false): ParsedItem[] {
  let kept = items.filter((it) => it.kind === "action" && (keepActions || ASK_OR_EXAM.has(it.id)));
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

/** What a stop word can stop ("הפסק אמבו") — "מוריד לחץ דם" isn't stopping a blood-pressure check. */
const STOPPABLE = ["cpr", "lucas", "o2", "bvm", "pacing", "cpap"];

function parseItems(text: string): Omit<Parsed, "statements"> {
  // "מגנזיום 25-50 מג לקג": a range isn't a dose — the drug asks for one number.
  const tokens = tokenize(text.replace(/(\d+(?:[.,]\d+)?)\s*[-–]\s*(\d+(?:[.,]\d+)?)/g, " טווחמינון "));
  // "חמש מיליגרם", "אחד גרם": a number word before a unit is the number.
  for (let k = 0; k + 1 < tokens.length; k++) {
    const n = NUMBER_WORDS[tokens[k]];
    if (n !== undefined && isUnitWord(tokens[k + 1])) tokens[k] = String(n);
  }
  const used = tokens.map(() => false);
  const found: { pos: number; item: ParsedItem }[] = [];
  const negated: string[] = [];
  const prepared: string[] = [];
  const preparedDrugs: NonNullable<Parsed["preparedDrugs"]> = [];
  const stopped: string[] = [];
  const contra: string[] = [];
  let flush = false;
  const mark = (a: number, b: number) => {
    for (let k = a; k < b; k++) used[k] = true;
  };
  /** The stop word right before an item ("הפסק אמבו"), or -1. */
  const stopAt = (start: number) => (start >= 1 && !used[start - 1] && variants(tokens[start - 1]).some((v) => STOP_TOKENS.includes(v)) ? start - 1 : -1);
  /** "מהול ב־4 סליין": where the dilution word is, up to three tokens back, or -1. */
  const dilutedAt = (start: number) => {
    for (let k = start - 1; k >= Math.max(0, start - 3); k--) if (variants(tokens[k]).some((v) => DILUTE_TOKENS.includes(v))) return k;
    return -1;
  };
  /** Does a drug start at k (after any route words)? */
  const drugAt = (k: number) => {
    while (k < tokens.length && isUnitWord(tokens[k])) k++;
    while (k < tokens.length && bestAt(tokens, used, k, ROUTE_PHRASES, true)) k = bestAt(tokens, used, k, ROUTE_PHRASES, true)!.end;
    return k < tokens.length && bestAt(tokens, used, k, DRUG_PHRASES) !== null;
  };

  // Pass 0: a dose answering "באיזה מינון?" — "0.4 מג מתחת ללשון", "200 מג לשריר" — keeps its route
  // (otherwise "ללשון" would read as a mouth exam). Only when the message starts with the number and names no drug.
  let bareAnswer: Parsed["bare"] = null;
  if (tokens.length && isNumber(tokens[0]) && !tokens.some((_, j) => bestAt(tokens, used, j, DRUG_PHRASES)?.cost === 0)) {
    const q = readQuantity(tokens, used, 0);
    // (a unit, or nothing else: "12 לידים" and "30:2" aren't doses)
    if (q && (q.unit !== null || q.end === tokens.length)) {
      mark(0, q.end);
      bareAnswer = { value: q.value, unit: q.unit, route: null };
      for (let j = q.end; j < tokens.length; j++) {
        const r = bestAt(tokens, used, j, ROUTE_PHRASES, true);
        if (!r) break;
        bareAnswer.route ??= r.phrase.key;
        mark(r.start, r.end);
        j = r.end - 1;
      }
    }
  }

  // Pass 1: drugs and their dose / unit / route.
  for (let i = 0; i < tokens.length; i++) {
    const m = bestAt(tokens, used, i, DRUG_PHRASES);
    if (!m) continue;
    // A typo-match on a drug never beats an exact action ("ניטור" isn't "ניטרו").
    if (m.cost > 0 && bestAt(tokens, used, i, ACTION_PHRASES)?.cost === 0) continue;
    mark(m.start, m.end);
    const skip = () => (i = m.end - 1);
    if (negatedBefore(tokens, m.start)) {
      negated.push(m.phrase.key);
      skip();
      continue;
    }
    if (describedBefore(tokens, m.start) || failedAfter(tokens, m.end)) {
      skip();
      continue;
    }
    const stop = stopAt(m.start);
    if (stop >= 0) {
      mark(stop, stop + 1);
      stopped.push(m.phrase.key);
      skip();
      continue;
    }
    // "קונטרה אינדיקציות לניטרט": checking whether it's allowed, not giving it.
    if (contraBefore(tokens, m.start)) {
      contra.push(m.phrase.key);
      skip();
      continue;
    }
    if (m.phrase.key === "saline") {
      const d = dilutedAt(m.start);
      if (d >= 0) {
        mark(d, m.start);
        skip();
        continue;
      }
      if (flushedBefore(tokens, m.start)) {
        flush = true;
        skip();
        continue;
      }
    }
    // A quantity right before the drug ("300 מג אספירין", "5 מג ונטולין 0.5 מג אירובנט").
    let before: { j: number; q: NonNullable<ReturnType<typeof readQuantity>> } | null = null;
    for (let j = Math.max(0, m.start - 4); j < m.start; j++) {
      const q = readQuantity(tokens, used, j);
      if (q && q.end === m.start) {
        before = { j, q };
        break;
      }
    }
    let value: number | null = null;
    let unit: string | null = null;
    let route: string | null = null;
    // A range right before the drug ("2-3 מג לקג של קטמין").
    let range = false;
    for (let k = m.start - 1; k >= 0 && !used[k] && (isUnitWord(tokens[k]) || tokens[k] === RANGE); k--) {
      if (tokens[k] === RANGE) {
        range = true;
        mark(k, m.start);
        break;
      }
    }
    // Look ahead a few tokens, stopping at the next drug.
    for (let j = m.end; j < Math.min(tokens.length, m.end + 8); j++) {
      if (used[j] || range) continue;
      if (bestAt(tokens, used, j, DRUG_PHRASES)?.cost === 0) break;
      if (tokens[j] === RANGE) {
        // (with doses written before each drug, a range after this one is the next drug's)
        if (before && drugAt(j + 1)) break;
        range = true;
        mark(j, j + 1);
        break;
      }
      if (value === null) {
        const q = readQuantity(tokens, used, j);
        // With doses written before each drug, the one after this drug is the next drug's.
        if (q && before && drugAt(q.end)) break;
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
      // The next action starts here ("אדנוזין ואק"ג 12" — the 12 isn't a dose). "לפי משקל" is part of the dose.
      const next = bestAt(tokens, used, j, ACTION_PHRASES);
      if (next?.cost === 0 && next.phrase.key !== "askWeight") break;
    }
    if (value === null && !range && before && !used[before.j]) {
      value = before.q.value;
      unit = before.q.unit;
      mark(before.j, before.q.end);
    }
    if (unit?.startsWith("/")) unit = (DRUGS.find((d) => d.id === m.phrase.key)?.unit ?? "") + unit;
    // Fluids are measured in ml: "סליין 20 מג לקג" is a slip for ml.
    if (VOLUME_DRUGS.includes(m.phrase.key) && unit?.startsWith("mg")) unit = unit.replace(/^mg/, "ml");
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
    // "מטופרולול 5 מג, סליין 10 מל": a few ml of saline after a drug flush the line — never a fluid bolus.
    if (m.phrase.key === "saline" && value !== null && value <= 20 && (unit === null || unit === "ml")) {
      flush = true;
      skip();
      continue;
    }
    // Drawn up ("שאיבת קטמין 100 מג") or got ready: the dose is kept for when it's given.
    const ready = preparedAt(tokens, m.start, m.end, DRAW_TOKENS);
    if (ready >= 0) {
      mark(ready, ready + 1);
      prepared.push(m.phrase.key);
      preparedDrugs.push({ drug: m.phrase.key, value, unit, route });
      skip();
      continue;
    }
    found.push({ pos: m.start, item: { kind: "drug", drug: m.phrase.key, value, unit, route, phrase: m.phrase.text, ...(range ? { range } : {}) } });
    skip();
  }

  // Pass 2: actions on what's left.
  for (let i = 0; i < tokens.length; i++) {
    if (used[i]) continue;
    const m = bestAt(tokens, used, i, ACTION_PHRASES);
    if (!m) continue;
    mark(m.start, m.end);
    const key = m.phrase.key;
    if (negatedBefore(tokens, m.start)) {
      negated.push(key);
      i = m.end - 1;
      continue;
    }
    if (describedBefore(tokens, m.start) || failedAfter(tokens, m.end)) {
      i = m.end - 1;
      continue;
    }
    const stop = STOPPABLE.includes(key) ? stopAt(m.start) : -1;
    if (stop >= 0) {
      mark(stop, stop + 1);
      if (STOP_AS[key]) found.push({ pos: m.start, item: { kind: "action", id: STOP_AS[key], phrase: m.phrase.text } });
      else stopped.push(key);
      i = m.end - 1;
      continue;
    }
    // Charging the defibrillator is getting the shock ready; drawing up "תרופות" is the drugs for intubation.
    // (Asking is never "got ready", and "הכנה ניהול נתיב אוויר" still looks at the airway.)
    const ready = key === "airway" || (key.startsWith("ask") && key !== "askMeds") ? -1 : preparedAt(tokens, m.start, m.end, key === "shock" || key === "sync" ? CHARGE_TOKENS : key === "askMeds" ? DRAW_TOKENS : []);
    if (ready >= 0) {
      mark(ready, ready + 1);
      prepared.push(key === "askMeds" ? "rsiDrugs" : key);
      i = m.end - 1;
      continue;
    }
    // "מינון לפי משקל" is a calculation, not a question about the weight.
    if (key === "askWeight" && m.start > 0 && variants(tokens[m.start - 1]).includes("לפי")) {
      i = m.end - 1;
      continue;
    }
    const item: ParsedItem = { kind: "action", id: key, phrase: m.phrase.text };
    if (key === "shock" || key === "sync") {
      // Energy right after ("שוק 200") or right before ("200 גאול שוק").
      for (const j of [m.end, m.end + 1, m.start - 2, m.start - 1]) {
        const q = j >= 0 ? readQuantity(tokens, used, j) : null;
        if (q && (q.unit === null || q.unit === "J" || q.unit === "J/kg" || q.unit === "/kg")) {
          item.joules = q.value;
          // "1 ג'אול לקג": a child's energy said per kilo
          if (q.unit?.endsWith("/kg")) item.joulesPerKg = true;
          mark(j, q.end);
          break;
        }
      }
    }
    found.push({ pos: m.start, item });
    i = m.end - 1;
  }

  // "שטיפה" alone: flushing the line.
  if (!found.length && tokens.length && tokens.every((t) => variants(t).some((v) => FLUSH_TOKENS.includes(v)) || variants(t).includes("סליינ"))) flush = true;
  // A lone quantity ("300 מג", "200") answers a pending question.
  let bare: Parsed["bare"] = bareAnswer;
  for (let i = 0; i < tokens.length; i++) {
    if (bare) break;
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
    .filter((it, k, all) => it.kind === "drug" || REPEATABLE.includes(it.id) || all.findIndex((o) => o.kind === "action" && o.id === it.id) === k)
    // "בית חולים דיווח" is the report to the hospital, not also a question about the drive.
    .filter((it, _k, all) => !(it.kind === "action" && it.id === "askHospital" && it.phrase === "בית חולים" && all.some((o) => o.kind === "action" && (o.id === "prealert" || o.id === "transport"))))
    // "כאבים בחזה" asks about chest pain — it isn't also a chest examination.
    .filter((it, _k, all) => !(it.kind === "action" && it.id === "chest" && it.phrase === "חזה" && all.some((o) => o.kind === "action" && o.id === "askPain")))
    // "נוזלים סליין 500 מל" names the saline twice: the one without a dose is the same order.
    .filter((it, k, all) => it.kind !== "drug" || it.value !== null || !all.some((o, j) => j !== k && o.kind === "drug" && o.drug === it.drug && (o.value !== null || j < k)));
  for (const d of contra) {
    const checks = d === "nitro" || d === "isoket" ? ["askPde5", "bp"] : ["askAllergies"];
    for (const id of checks) if (!items.some((it) => it.kind === "action" && it.id === id)) items.push({ kind: "action", id, phrase: "" });
  }
  return { items, bare, negated, prepared: [...new Set(prepared)], planned: [], flush, contra, preparedDrugs, stopped };
}
