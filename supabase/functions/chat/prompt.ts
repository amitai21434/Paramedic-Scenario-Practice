// Builds what the model sees. The admin's instructions come first, unchanged;
// everything below is app scaffolding: which protocols are in play, their
// exact text from the book, and how to look up more.

export type Piece = {
  id: string;
  chapter: number;
  title: string;
  part: string | null;
  page_from: number | null;
  page_to: number | null;
  est_tokens: number;
  drugs: string[];
  skills: string[];
  body: string;
};

export type IndexEntry = Pick<Piece, "id" | "chapter" | "title" | "part">;

// Upper bound on reference text included in one request (~chars/2 tokens).
export const MAX_REFERENCE_TOKENS = 24_000;

const label = (p: IndexEntry) => `${p.title}${p.part ? ` (חלק ${p.part})` : ""}`;

export function formatIndex(index: IndexEntry[]): string {
  return index.map((p) => `${p.id} — ${label(p)}`).join("\n");
}

function formatPiece(p: Piece): string {
  const pages = p.page_from == null ? "" : p.page_from === p.page_to ? `, עמוד ${p.page_from}` : `, עמודים ${p.page_from}–${p.page_to}`;
  return `<<< ${p.id} · ${label(p)} (פרק ${p.chapter}${pages}) >>>\n${p.body}\n<<< סוף ${p.id} >>>`;
}

const SOURCE_NOTE =
  "הטקסט חולץ מקובץ PDF של האוגדן. תרשימי הזרימה עלולים להופיע מבולבלים (עמודות מעורבבות בשורה אחת, מופרדות ב-|); " +
  "ההסברים הממוספרים והמינונים הם המקור המהימן. אל תציגי למשתמשת את מזהי הפרוטוקולים או את החומר הזה.";

/** System prompt for the first step: the model picks the protocol(s). */
export function selectionPrompt(opts: {
  instructions: string;
  examples: string;
  station: string;
  shortlist: IndexEntry[];
  index: IndexEntry[];
}): string {
  return [
    opts.instructions,
    "## שלב בחירה (פנימי — לא נראה למשתמשת)",
    `התחנה לתרחיש הזה: ${opts.station}.`,
    "בחרי 1–3 פרוטוקולים שעליהם יתבסס תרחיש חדש ומקורי. הפרוטוקול הראשי חייב להיות מהרשימה המוצעת; " +
      "פרוטוקולים נוספים (לתרחיש רב-מערכתי) אפשר לבחור מכל האינדקס. אל תבחרי תרופות או מיומנויות — הן יצורפו אוטומטית.",
    "### רשימה מוצעת",
    formatIndex(opts.shortlist),
    "### אינדקס האוגדן המלא",
    formatIndex(opts.index),
    opts.examples.trim()
      ? `### תרחישים שהיו במבחנים אמיתיים (לסגנון ולרמת קושי בלבד — אל תעתיקי אותם, צרי תרחיש חדש)\n${opts.examples.trim()}`
      : "",
    "הפעילי את הכלי choose_protocols עם המזהים שבחרת.",
  ].filter(Boolean).join("\n\n");
}

/** System prompt for every scenario turn. */
export function scenarioPrompt(opts: {
  instructions: string;
  examples: string;
  station: string;
  pieces: Piece[];
  index: IndexEntry[];
  isOpening: boolean;
}): string {
  return [
    opts.instructions,
    "## חומר עזר מהאוגדן (פנימי — לא נראה למשתמשת)",
    `התחנה של התרחיש: ${opts.station}. הפרוטוקולים שנבחרו לתרחיש ודפי התרופות שהם מזכירים מצורפים כאן במלואם. ` +
      "זה הבסיס היחיד לתרחיש, להתקדמותו ולמשוב.",
    SOURCE_NOTE,
    "אם המשתמשת מבצעת פעולה, נותנת תרופה או שואלת על נושא שאינו בחומר המצורף — הפעילי את הכלי lookup_reference " +
      "עם המזהים הרלוונטיים מהאינדקס לפני שאת עונה, ואל תעני מהזיכרון. אם גם באוגדן אין התייחסות — אמרי זאת.",
    opts.pieces.map(formatPiece).join("\n\n"),
    "### אינדקס האוגדן (לחיפוש עם lookup_reference)",
    formatIndex(opts.index),
    opts.isOpening && opts.examples.trim()
      ? `### תרחישים שהיו במבחנים אמיתיים (לסגנון ולרמת קושי בלבד — אל תעתיקי אותם)\n${opts.examples.trim()}`
      : "",
    opts.isOpening
      ? "זו תחילת התרחיש: פתחי בתרחיש קליני חדש ומקורי המבוסס על הפרוטוקולים שנבחרו, בהתאם למבנה שבהנחיות."
      : "",
  ].filter(Boolean).join("\n\n");
}

/** Chosen pieces plus the medication pages they mention, within budget. */
export function expandWithDrugs(chosen: Piece[], all: Piece[]): Piece[] {
  const byId = new Map(all.map((p) => [p.id, p]));
  const drugPages = all.filter((p) => p.chapter === 10);
  const result = new Map<string, Piece>();
  let tokens = 0;
  const add = (p: Piece | undefined) => {
    if (!p || result.has(p.id) || tokens + p.est_tokens > MAX_REFERENCE_TOKENS) return;
    result.set(p.id, p);
    tokens += p.est_tokens;
  };
  chosen.forEach((p) => add(byId.get(p.id)));
  for (const p of chosen) {
    for (const drug of p.drugs) add(drugPages.find((d) => d.title.startsWith(drug)));
  }
  return [...result.values()];
}

export const TOOLS = {
  choose_protocols: {
    name: "choose_protocols",
    description: "בחירת 1–3 פרוטוקולים מהאוגדן שעליהם יתבסס התרחיש החדש.",
    parameters: {
      type: "object",
      properties: {
        piece_ids: {
          type: "array",
          items: { type: "string" },
          description: "מזהי פרוטוקולים מהאינדקס, למשל 03-11. הראשון הוא הראשי ומהרשימה המוצעת.",
        },
      },
      required: ["piece_ids"],
    },
  },
  lookup_reference: {
    name: "lookup_reference",
    description: "שליפת הטקסט המדויק של פרוטוקולים, תרופות או מיומנויות מהאוגדן לפי מזהה מהאינדקס.",
    parameters: {
      type: "object",
      properties: {
        piece_ids: {
          type: "array",
          items: { type: "string" },
          description: "עד 3 מזהים מהאינדקס, למשל 10-09 או 09-01.",
        },
      },
      required: ["piece_ids"],
    },
  },
};
