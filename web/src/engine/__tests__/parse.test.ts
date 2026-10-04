import { describe, expect, it } from "vitest";
import { parse } from "../parse";

const ids = (text: string) =>
  parse(text).items.map((i) => (i.kind === "action" ? i.id : `${i.drug}:${i.value ?? "?"}${i.unit ?? ""}${i.route ? "@" + i.route : ""}`));

describe("parse", () => {
  it("reads several actions in one message", () => {
    expect(ids("מחבר מוניטור, מודד לחץ דם וסטורציה")).toEqual(["monitor", "bp", "spo2"]);
  });
  it("reads drug with dose, unit and route", () => {
    expect(ids('נותן אספירין 300 מ"ג בלעיסה')).toEqual(["aspirin:300mg@po"]);
    expect(ids("אדרנלין 1 מג IV")).toEqual(["adrenaline:1mg@iv"]);
    expect(ids("300mg אספירין")).toEqual(["aspirin:300mg"]);
    expect(ids("דופמין 5 מקג/קג/דקה")).toEqual(["dopamine:5mcg/kg/min"]);
    expect(ids("אטרופין 0.5")).toEqual(["atropine:0.5"]);
  });
  it("handles prefixes and typos", () => {
    expect(ids("ונותנת אדרנאלין 1מג")).toEqual(["adrenaline:1mg"]);
    expect(ids("מחברת למוניטור")).toEqual(["monitor"]);
    expect(ids("אינטובצייה")).toEqual(["intubation"]);
  });
  it("prefers longer phrases", () => {
    expect(ids("שוק מסונכרן 100 גאול")).toEqual(["sync"]);
    expect(parse("שוק מסונכרן 100 גאול").items[0]).toMatchObject({ joules: 100 });
    expect(ids("שוק 200")).toEqual(["shock"]);
    expect(ids("קצב נשימה")).toEqual(["rr"]);
    expect(ids("אק\"ג 12 ערוצים")).toEqual(["ecg12"]);
    expect(ids("הנשמה במפוח")).toEqual(["bvm"]);
  });
  it("does not read a drug route as an action", () => {
    expect(ids("אמיודרון 300 מג IO")).toEqual(["amiodarone:300mg@io"]);
  });
  it("skips negated items", () => {
    expect(ids("לא נותן ניטרו, נותן נוזלים 250")).toEqual(["saline:250"]);
  });
  it("leaves a bare quantity for pending questions", () => {
    expect(parse("300 מג").bare).toEqual({ value: 300, unit: "mg" });
  });
  it("keeps a following action out of a drug's dose", () => {
    expect(ids("אדנוזין ואקג 12")).toEqual(["adenosine:?", "ecg12"]);
  });
});

describe("statements", () => {
  it("splits a diagnosis off from actions in the same message", () => {
    const p = parse("חושדת ב-STEMI תחתון, נותנת אספירין 300 מג");
    expect(p.statements).toEqual(["חושדת ב-STEMI תחתון"]);
    expect(p.items).toMatchObject([{ kind: "drug", drug: "aspirin", value: 300 }]);
  });
  it("doesn't read a diagnosis as an exam action", () => {
    const p = parse("אבחנה: בצקת ריאות");
    expect(p.items).toEqual([]);
    expect(p.statements).toHaveLength(1);
  });
  it("ordinary actions aren't statements", () => {
    for (const t of ["בודקת את הקצב", "קצב נשימה", "מה הקצב"]) expect(parse(t).statements, t).toEqual([]);
  });
  it("doesn't mistake similar words for actions", () => {
    expect(ids("מקשיב לריאות")).toEqual(["lungs"]);
    expect(ids("ליטר בדקה חמצן")).toEqual(["o2"]);
    expect(ids("מדווח לחדר מיון")).toEqual([]);
    expect(ids("בולוס 500")).toEqual([]);
  });
  it("reads newly added vocabulary", () => {
    expect(ids("מתחיל עירוי")).toEqual(["iv"]);
    expect(ids("מזעזע 200")).toEqual(["shock"]);
    expect(ids("לוחץ על הדימום")).toEqual(["pressure"]);
    expect(ids("אגנית")).toEqual(["pelvicBinder"]);
    expect(ids("אמבולנס נוסף")).toEqual(["backup"]);
    expect(ids("דיווח לחדר מיון")).toEqual(["prealert"]);
    expect(ids("בשאיפה ונטולין")).toEqual(["salbutamol:?@neb"]);
  });
});

describe("question phrasing", () => {
  const ids = (s: string) => parse(s).items.map((i) => (i.kind === "action" ? i.id : i.drug));
  it("reads natural history questions", () => {
    expect(ids("מה אכלת היום?")).toContain("askLastMeal");
    expect(ids("יש לך סכרת?")).toContain("askHistory");
    expect(ids("מקשיב ללב")).toContain("heart");
  });
  it("allergy question doesn't also ask meds", () => {
    const r = ids("יש רגישות לתרופות?");
    expect(r).toContain("askAllergies");
    expect(r).not.toContain("askMeds");
  });
});

describe("everyday phrasings", () => {
  const a = (s: string) => parse(s).items.map((i) => (i.kind === "action" ? i.id : i.drug));
  it("reads saline, c-spine and cannula wording", () => {
    expect(parse("מלח 500 מל").items[0]).toMatchObject({ kind: "drug", drug: "saline" });
    expect(a("מקבע צוואר")).toEqual(["cSpine"]);
    expect(a("מחדיר קנולה")).toEqual(["iv"]);
    expect(a("חמצן בקנולה אפית")).toEqual(["o2"]);
    expect(a("מרים רגליים")).toEqual(["positionSupine"]);
  });
});

describe("protocol actions", () => {
  const a = (s: string) => parse(s).items.map((i) => (i.kind === "action" ? i.id : i.drug));
  it("reads pump, consult, head-of-bed and asthma history wording", () => {
    expect(a("מנתק את משאבת האינסולין")).toEqual(["pumpOff"]);
    expect(a("מתייעץ עם רופא המוקד")).toEqual(["consultDoc"]);
    expect(a("מרים את ראש המיטה ל-30 מעלות")).toEqual(["positionSit"]);
    expect(a("יש לך אסתמה?")).toEqual(["askHistory"]);
  });
});
