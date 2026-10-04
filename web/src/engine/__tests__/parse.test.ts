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
