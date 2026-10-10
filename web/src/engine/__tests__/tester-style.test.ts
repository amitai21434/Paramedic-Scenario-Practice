// Messages written the way the first real tester writes: long, first person, "she", reasoning,
// plans ("אם...", "לפני ש..."), preparation and typos. Each reading was checked by hand.

import { describe, expect, it } from "vitest";
import { parse } from "../parse";

const read = (text: string) => parse(text).items.map((x) => (x.kind === "action" ? x.id : `${x.drug}:${x.value ?? "?"}${x.unit ?? ""}${x.route ? "@" + x.route : ""}`));

const CASES: { text: string; items: string[]; prepared?: string[] }[] = [
  {
    text: "אני בודקת בטיחות ונכנסת, מה ההתרשמות הכללית שלה?",
    items: [
      "scene",
      "general"
    ]
  },
  {
    text: "אני שואלת אותו מה קרה ומתי זה התחיל, ואם הכאב מקרין לאיזשהו מקום",
    items: [
      "askComplaint",
      "askOnset",
      "askPain"
    ]
  },
  {
    text: "אני מבקשת מהאיש צוות לחבר מוניטור ולעשות אקג 12, ואני מודדת לחץ דם",
    items: [
      "monitor",
      "ecg12",
      "bp"
    ]
  },
  {
    text: "יש לו רגישות לתרופות? הוא לקח ויאגרה או משהו דומה ביומיים האחרונים?",
    items: [
      "askAllergies",
      "askPde5"
    ]
  },
  {
    text: "אני נותנת אספירין 300 מג ללעיסה",
    items: [
      "aspirin:300mg@po"
    ]
  },
  {
    text: "לפני שאני נותנת ניטרו אני בודקת לחץ דם ושואלת על ויאגרה",
    items: [
      "bp",
      "askPde5"
    ]
  },
  {
    text: "אם הלחץ דם מעל 90 אני נותנת ניטרו 0.4 מתחת ללשון",
    items: [
      "bp"
    ]
  },
  {
    text: "הכאב לא עבר אחרי הניטרו אז אני רוצה לתת פנטניל 50 מקג לוריד",
    items: [
      "askPain",
      "fentanyl:50mcg@iv"
    ]
  },
  {
    text: "אני מכינה את המפוח והדפיברילטור ליד למקרה שהוא יתדרדר",
    items: [],
    prepared: [
      "bvm",
      "monitor"
    ]
  },
  {
    text: "אני מעדכנת את בית החולים שאנחנו מגיעים עם סטמי תחתון",
    items: [
      "prealert"
    ]
  },
  {
    text: "אני חושבת שזה אוטם תחתון",
    items: []
  },
  {
    text: "אני מתחילה עיסויים ומבקשת מהאיש צוות להדביק מדבקות ולחבר מוניטור",
    items: [
      "cpr",
      "monitor"
    ]
  },
  {
    text: "זה VF אז אני נותנת שוק 200",
    items: [
      "shock"
    ]
  },
  {
    text: "אחרי השוק ממשיכים עיסויים שתי דקות ואני פותחת IO",
    items: [
      "cpr",
      "io"
    ]
  },
  {
    text: "אני נותנת אדרנלין 1 מג ו שטיפה 20 מל",
    items: [
      "adrenaline:1mg"
    ]
  },
  {
    text: "אני מנשימה עם אמבו וחמצן 15 ליטר, 30:2",
    items: [
      "bvm",
      "o2",
      "cpr"
    ]
  },
  {
    text: "יש דופק? אני בודקת דופק קרוטידי",
    items: [
      "pulse"
    ]
  },
  {
    text: "אני שואלת את האמא כמה הוא שוקל ומה קרה",
    items: [
      "askWeight",
      "askComplaint"
    ]
  },
  {
    text: "אני מחשבת מינון אדרנלין לפי משקל, 0.01 לקילו זה 0.2 מג, נותנת לשריר",
    items: [
      "adrenaline:0.2mg@im"
    ]
  },
  {
    text: "אני מרגיעה את הילד ומושיבה אותו על האמא",
    items: [
      "reassure",
      "positionSit"
    ]
  },
  {
    text: "אני נותנת ונטולין באינהלציה 2.5 מג עם חמצן",
    items: [
      "salbutamol:2.5mg@neb",
      "o2"
    ]
  },
  {
    text: "המצב לא משתפר, אז אני מוסיפה אירובנט 0.25 מג לאינהלציה",
    items: [
      "ipratropium:0.25mg@neb"
    ]
  },
  {
    text: "אני בודקת שאין דימומים פורצים ומקבעת צוואר ידנית",
    items: [
      "bleedCheck",
      "cSpine"
    ]
  },
  {
    text: "אני מבקשת מהצוות להביא קרש וצווארון",
    items: [],
    prepared: [
      "cSpine"
    ]
  },
  {
    text: "אני חושפת את החזה ומקשיבה לריאות משני הצדדים",
    items: [
      "chest",
      "lungs"
    ]
  },
  {
    text: "אין כניסת אוויר משמאל ויש סטיית קנה, אז אני עושה ניקור חזה בצד שמאל",
    items: [
      "neck",
      "needle"
    ]
  },
  {
    text: "אני בודקת את האגן ושמה חגורת אגן",
    items: [
      "pelvis",
      "pelvicBinder"
    ]
  },
  {
    text: "אני שמה חוסם עורקים מעל הפציעה ורושמת את השעה",
    items: [
      "tourniquet"
    ]
  },
  {
    text: "אני בודקת סוכר, אם נמוך אני אתן גלוקוז",
    items: [
      "glucose"
    ]
  },
  {
    text: "הסוכר נמוך אז אני נותנת גלוקוז 10% 250 מל לוריד",
    items: [
      "glucose",
      "dextrose:250ml@iv"
    ]
  },
  {
    text: "אני משכיבה אותה על הצד כי היא מקיאה ושואבת הפרשות",
    items: [
      "positionSupine",
      "positionSide",
      "suction"
    ]
  },
  {
    text: "אני לא נותנת ניטרו כי הלחץ דם נמוך",
    items: [
      "bp"
    ]
  },
  {
    text: "אני רוצה לשאול אותה אם היא בהריון",
    items: [
      "askPregnant"
    ]
  },
  {
    text: "אני מתקשרת לרופא כונן להתייעצות",
    items: [
      "consultDoc"
    ]
  },
  {
    text: "אני מסבירה לה מה אני עושה ומרגיעה אותה",
    items: [
      "reassure"
    ]
  },
  {
    text: "תוך כדי פינוי אני מנטרת אותה וחוזרת על המדדים כל 5 דקות",
    items: [
      "transport",
      "vitals"
    ]
  },
  {
    text: "אני בודקת שהוונפלון במקום ושוטפת עם סליין",
    items: [
      "iv"
    ]
  },
  {
    text: "אני מכינה דורמיקום למקרה שהיא תפרכס שוב",
    items: [],
    prepared: [
      "midazolam"
    ]
  },
  {
    text: "היא מפרכסת, אני נותנת דורמיקום 5 מג לשריר",
    items: [
      "midazolam:5mg@im"
    ]
  },
  {
    text: "מה הסטורציה שלה עכשיו?",
    items: [
      "spo2"
    ]
  },
  {
    text: "אני שמה לה חמצן במשקפיים 2 ליטר כי הסטורציה 92",
    items: [
      "o2",
      "spo2"
    ]
  },
  {
    text: "אני מודדת חום וסוכר ובודקת אישונים",
    items: [
      "temp",
      "glucose",
      "pupils"
    ]
  },
  {
    text: "בגלל שהיא לא מגיבה לקול אני בודקת תגובה לכאב",
    items: [
      "consciousness"
    ]
  },
  {
    text: "יש לה צואה שחורה? מתי אכלה בפעם האחרונה?",
    items: [
      "askSymptoms",
      "askLastMeal"
    ]
  },
  {
    text: "אני מושיבה אותו ונותנת לו לנשום, ואם הוא מתעייף אז סיפאפ",
    items: [
      "positionSit"
    ]
  },
  {
    text: "אני מודדת שוב לחץ דם אחרי הבולוס",
    items: [
      "bp"
    ]
  },
  {
    text: "אני לוקחת אותה לאמבולנס על כסא",
    items: [
      "transport"
    ]
  },
  {
    text: "היא לוקחת תרופות באופן קבוע?",
    items: [
      "askMeds"
    ]
  },
  {
    text: "יש לה אלרגיה לתרופות או היא לוקחת תרופות באופן כבוע",
    items: [
      "askAllergies",
      "askMeds"
    ]
  },
  {
    text: "אני מסתכלת על העור, צבע, לחות ומילוי קפילרי",
    items: [
      "skin",
      "capRefill"
    ]
  },
  {
    text: "אני בודקת אם יש לה כאבים בחזה או קוצר נשימה",
    items: [
      "askPain",
      "askSymptoms"
    ]
  },
  {
    text: "אני שואלת אם היא סוכרתית ומה הסוכר שלה בדרך כלל",
    items: [
      "askHistory",
      "glucose"
    ]
  }
];

describe("tester-style messages", () => {
  for (const c of CASES) {
    it(c.text, () => {
      expect(read(c.text)).toEqual(c.items);
      if (c.prepared) expect(parse(c.text).prepared).toEqual(c.prepared);
    });
  }
  it("plans are noted, not done", () => {
    expect(parse("אני בודקת סוכר, אם נמוך אני אתן גלוקוז").planned).toEqual(["dextrose"]);
    expect(parse("לפני שאני נותנת ניטרו אני בודקת לחץ דם ושואלת על ויאגרה").planned).toEqual(["nitro"]);
    expect(parse("אני בודקת שהוונפלון במקום ושוטפת עם סליין").flush).toBe(true);
  });
});
