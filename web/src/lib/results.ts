// Saving and loading finished-scenario results (table scenario_results).
// Row-level security limits each student to their own rows (the admin reads all).

import type { Content, Sim } from "../engine/types";
import { buildResult, buildTranscript, type ResultRow, type Transcript } from "./history";
import { supabase } from "./supabase";

/** Everything but the transcript, which is only loaded when the admin opens a run. */
export const RESULT_COLUMNS = "id, user_id, scenario, title, station, score_done, score_total, critical_missed, duration_sec, details, created_at";

/** Saves a finished scenario for the signed-in student. "skipped": too short to count, or not signed in. */
export async function saveResult(content: Content, sim: Sim): Promise<"saved" | "skipped" | "failed"> {
  const row = buildResult(content, sim);
  if (!row) return "skipped";
  const { data } = await supabase.auth.getSession();
  if (!data.session) return "skipped";
  const userId = data.session.user.id;
  // The full transcript only for users the admin picked; the database rejects it for anyone else.
  const { data: me } = await supabase.from("profiles").select("keep_transcripts").eq("id", userId).maybeSingle();
  const transcript = me?.keep_transcripts ? buildTranscript(sim) : null;
  const { error } = await supabase.from("scenario_results").insert({ ...row, user_id: userId, ...(transcript ? { transcript } : {}) });
  return error ? "failed" : "saved";
}

/** Admin: one saved run's transcript (null when it wasn't kept). */
export async function loadTranscript(id: number): Promise<Transcript | null> {
  const { data, error } = await supabase.from("scenario_results").select("transcript").eq("id", id).single();
  if (error) throw new Error(error.message);
  return (data?.transcript ?? null) as Transcript | null;
}

/** Admin: whether a user's full scenarios are kept. */
export async function setKeepTranscripts(email: string, keep: boolean): Promise<void> {
  const { error } = await supabase.rpc("set_keep_transcripts", { target_email: email, keep });
  if (error) throw new Error(error.message);
}

export async function loadResults(userId: string): Promise<ResultRow[]> {
  const { data, error } = await supabase
    .from("scenario_results")
    .select(RESULT_COLUMNS)
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
