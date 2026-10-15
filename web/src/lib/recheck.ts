// Re-checks a logged "not understood" message against the current engine, in the storyline it came
// from — so the admin list shows only what still fails, and the rest can be removed.

import { startSim, step } from "../engine/engine";
import { parse } from "../engine/parse";
import type { Content } from "../engine/types";

export function understoodNow(content: Content, text: string, scenario: string): boolean {
  // A lone number ("250", "1 גרם") answers "באיזה מינון?" — it was only "not understood" without that question.
  if (parse(text).bare && !/[א-תa-z]{3,}/i.test(text.replace(/מ"?ג|מ״ג|מק"?ג|מקג|מ"?ל|מ״ל|גרם|ק"?ג|לק"?ג|לק״ג|ג'אול|גאול/g, ""))) return true;
  const [id, variant] = scenario.split("/");
  if (!content.cases.some((c) => c.id === id)) return false;
  try {
    const sim = startSim(content, id, 1, variant && variant !== "null" ? variant : undefined);
    return step(content, sim, text).understood;
  } catch {
    return false;
  }
}
