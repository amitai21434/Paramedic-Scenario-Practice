import type { Content } from "../engine/types";
import { validate } from "../engine/validate";
import { supabase } from "./supabase";

let cached: Promise<Content> | null = null;

/**
 * The scenario content is private: in production it's read from Supabase,
 * where RLS lets only signed-in users see it. The dev server serves it from
 * the local content/ folder instead (always fresh, no upload needed).
 */
export function loadContent(): Promise<Content> {
  if (!cached) {
    cached = (import.meta.env.DEV ? fromDevServer() : fromSupabase()).catch((e) => {
      cached = null;
      throw e;
    });
  }
  return cached;
}

async function fromDevServer(): Promise<Content> {
  const res = await fetch("./dev-content.json");
  if (!res.ok) throw new Error(await res.text());
  const content = (await res.json()) as Content;
  const problems = validate(content);
  if (problems.length) console.warn("Scenario content problems:\n" + problems.join("\n"));
  return content;
}

async function fromSupabase(): Promise<Content> {
  const { data, error } = await supabase.from("scenario_content").select("data").eq("id", "bundle").single();
  if (error || !data) throw new Error(error?.message ?? "No scenario content");
  return data.data as Content;
}

/** Records a message the parser couldn't understand, so the vocabulary can be extended. Best effort. */
export async function logUnrecognized(text: string, scenario: string) {
  const { data } = await supabase.auth.getSession();
  if (!data.session) return;
  await supabase.from("unrecognized_inputs").insert({ user_id: data.session.user.id, text: text.slice(0, 500), scenario });
}
