// Saving and loading finished-scenario results (table scenario_results).
// Row-level security limits each student to their own rows (the admin reads all).

import type { Content, Sim } from "../engine/types";
import { buildResult, type ResultRow } from "./history";
import { supabase } from "./supabase";

/** Saves a finished scenario for the signed-in student. "skipped": too short to count, or not signed in. */
export async function saveResult(content: Content, sim: Sim): Promise<"saved" | "skipped" | "failed"> {
  const row = buildResult(content, sim);
  if (!row) return "skipped";
  const { data } = await supabase.auth.getSession();
  if (!data.session) return "skipped";
  const { error } = await supabase.from("scenario_results").insert({ ...row, user_id: data.session.user.id });
  return error ? "failed" : "saved";
}

export async function loadResults(userId: string): Promise<ResultRow[]> {
  const { data, error } = await supabase
    .from("scenario_results")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw new Error(error.message);
  return (data ?? []) as ResultRow[];
}

export async function clearResults(userId: string): Promise<void> {
  const { error } = await supabase.from("scenario_results").delete().eq("user_id", userId);
  if (error) throw new Error(error.message);
}
