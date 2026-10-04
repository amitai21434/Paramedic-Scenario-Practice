import { it } from "vitest";
import { parse } from "../parse";
it("d", () => {
  for (const p of ["מזעיק משטרה ושומר מרחק", "מנסה להרגיע אותו", "מדבר איתו בשקט ומרגיע", "הגבלה פיזית", "קטמין 2 מג לקג לשריר", "דורמיקום 5 מג IM", "קטמין 1 מג לקג IV", "שומר מרחק"]) {
    console.log(p, JSON.stringify(parse(p).items.map((i) => (i.kind === "action" ? i.id : `${i.drug}:${i.value}${i.unit}@${i.route}`))));
  }
});
