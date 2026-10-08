import { FunctionsHttpError } from "@supabase/supabase-js";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Bubble, DispatchCard } from "../components/Chat";
import { clock } from "../engine/engine";
import { percent, weakSpots, type ResultRow, type Transcript } from "../lib/history";
import { loadTranscript, RESULT_COLUMNS, setKeepTranscripts } from "../lib/results";
import { supabase, type Profile } from "../lib/supabase";

// Everything here is also enforced server-side: RLS only lets the admin read
// all profiles and the unrecognized-input log, and the invite-user function
// re-checks the caller's role.
export default function Admin() {
  return (
    <main className="mx-auto w-full max-w-3xl space-y-10 p-6">
      <Invite />
      <Users />
      <Results />
      <Unrecognized />
    </main>
  );
}

function Invite() {
  const [email, setEmail] = useState("");
  const [keep, setKeep] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setResult(null);
    const { error } = await supabase.functions.invoke("invite-user", {
      body: { email, redirectTo: window.location.origin + window.location.pathname },
    });
    if (error) {
      const body = error instanceof FunctionsHttpError ? await error.context.json().catch(() => null) : null;
      setResult({ ok: false, message: body?.error ?? "Couldn't send the invite." });
    } else {
      let note = "";
      if (keep) {
        try {
          await setKeepTranscripts(email, true);
          note = " Their full scenarios will be saved.";
        } catch {
          note = " (Couldn't turn on saving full scenarios — use the checkbox in Users.)";
        }
      }
      setResult({ ok: true, message: `Invite sent to ${email}.${note}` });
      setEmail("");
      setKeep(false);
    }
    setPending(false);
  }

  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold">Invite a user</h2>
      <form onSubmit={onSubmit} className="flex flex-wrap items-center gap-2">
        <input
          type="email"
          required
          placeholder="email@example.com"
          className="input flex-1"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <button disabled={pending} className="btn">
          {pending ? "Sending…" : "Send invite"}
        </button>
        <label className="flex w-full items-center gap-2 text-sm text-muted">
          <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
          Save their full scenarios (everything they type and every reply)
        </label>
      </form>
      {result && (
        <p className={`text-sm ${result.ok ? "text-green-600" : "text-red-600"}`}>{result.message}</p>
      )}
    </section>
  );
}

function Users() {
  const [users, setUsers] = useState<(Profile & { keep_transcripts?: boolean })[]>([]);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    const { data } = await supabase
      .from("profiles")
      .select("id, email, name, role, keep_transcripts")
      .order("created_at");
    setUsers(data ?? []);
  }, []);
  async function toggle(email: string, keep: boolean) {
    setError("");
    try {
      await setKeepTranscripts(email, keep);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't change it.");
    }
    load();
  }
  useEffect(() => {
    load();
  }, [load]);

  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold">Users</h2>
      <p className="text-sm text-muted">"Full scenarios": save everything they type and every reply, viewable under Results.</p>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <ul className="divide-y divide-neutral-200 rounded border border-neutral-200 text-sm dark:divide-neutral-800 dark:border-neutral-800">
        {users.map((u) => (
          <li key={u.id} className="flex justify-between gap-4 px-3 py-2">
            <span dir="auto">
              {u.name || <em className="text-neutral-500">invite pending</em>}{" "}
              <span className="text-neutral-500">{u.email}</span>
            </span>
            <span className="flex shrink-0 items-center gap-4 text-neutral-500">
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={!!u.keep_transcripts} onChange={(e) => toggle(u.email, e.target.checked)} />
                Full scenarios
              </label>
              {u.role}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

type AdminResultRow = ResultRow & { has_transcript?: boolean; profiles: { name: string; email: string } | null };

/** Everyone's finished scenarios, and what the whole group misses most. */
function Results() {
  const [rows, setRows] = useState<AdminResultRow[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  useEffect(() => {
    supabase
      .from("scenario_results")
      .select(`${RESULT_COLUMNS}, has_transcript, profiles(name, email)`)
      .order("created_at", { ascending: false })
      .limit(1000)
      .then(({ data }) => setRows((data ?? []) as unknown as AdminResultRow[]));
  }, []);
  const spots = weakSpots(rows, 10);

  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold">Results</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-neutral-500">No finished scenarios yet.</p>
      ) : (
        <>
          <div dir="rtl" className="text-sm">
            <h3 className="font-medium">הכי מפספסים — כל הקבוצה ({spots.runs} תרחישים)</h3>
            <ul className="list-disc ps-5">
              {spots.missed.map((m) => (
                <li key={m.label}>
                  {m.label} <span className="text-xs text-neutral-500">— {m.missed}/{m.of}</span>
                </li>
              ))}
            </ul>
          </div>
          <ul className="divide-y divide-neutral-200 rounded border border-neutral-200 text-sm dark:divide-neutral-800 dark:border-neutral-800">
            {rows.slice(0, 100).map((r) => (
              <li key={r.id} className="px-3 py-2">
                <div className="flex justify-between gap-4">
                  <span dir="auto">
                    {r.profiles?.name || r.profiles?.email} — {r.title}
                  </span>
                  <span className="flex shrink-0 items-center gap-3 text-neutral-500">
                    {r.has_transcript && (
                      <button className="text-accent underline-offset-2 hover:underline" onClick={() => setOpen(open === r.id ? null : r.id)}>
                        {open === r.id ? "Close" : "View"}
                      </button>
                    )}
                    {percent(r)}% · {new Date(r.created_at).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" })}
                  </span>
                </div>
                {open === r.id && <RunView row={r} />}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/** One saved run, read-only: the conversation as the student saw it, then the summary. */
function RunView({ row }: { row: AdminResultRow }) {
  const [t, setT] = useState<Transcript | null | undefined>(undefined);
  const [error, setError] = useState("");
  useEffect(() => {
    loadTranscript(row.id).then(setT, (e) => setError(String(e.message ?? e)));
  }, [row.id]);
  if (error) return <p className="mt-2 text-sm text-red-600">{error}</p>;
  if (t === undefined) return <p className="mt-2 text-sm text-muted">Loading…</p>;
  if (t === null) return <p className="mt-2 text-sm text-muted">No transcript saved for this run.</p>;
  const d = row.details;
  return (
    <div dir="rtl" className="mt-3 space-y-4 rounded-lg border border-line bg-bg p-3">
      <p className="text-xs text-muted">
        {row.scenario} · seed {t.seed}
        {t.complication ? ` · סיבוך: ${t.complication}` : ""} · משך {clock(row.duration_sec)}
      </p>
      <div className="space-y-3">
        {t.messages.map((m, i) => (i === 0 && m.from === "examiner" && "text" in m ? <DispatchCard key={i} text={m.text} /> : <Bubble key={i} m={m} />))}
      </div>
      <div className="space-y-2 border-t border-line pt-3 text-sm">
        <p className="font-semibold">
          {percent(row)}% · {row.score_done}/{row.score_total} פעולות לפי הפרוטוקול
        </p>
        {d.errors.length > 0 && (
          <ul className="list-disc ps-5 text-red-300">
            {d.errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        )}
        <ul className="space-y-0.5">
          {d.checklist.map((c, i) => (
            <li key={i}>
              {c.done ? (c.late ? "⚠️" : "✅") : c.critical ? "❌" : "▫️"} {c.label}
            </li>
          ))}
        </ul>
        {d.warnings.length > 0 && <p className="text-muted">הערות: {d.warnings.join(" · ")}</p>}
      </div>
    </div>
  );
}

type UnrecognizedRow = { id: number; text: string; scenario: string; created_at: string };

/** Messages the scenario engine couldn't understand — words to add to the vocabulary (web/src/engine/lexicon.ts). */
function Unrecognized() {
  const [rows, setRows] = useState<UnrecognizedRow[]>([]);
  useEffect(() => {
    supabase
      .from("unrecognized_inputs")
      .select("id, text, scenario, created_at")
      .order("id", { ascending: false })
      .limit(100)
      .then(({ data }) => setRows(data ?? []));
  }, []);

  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold">Unrecognized messages</h2>
      <p className="text-sm text-neutral-500">
        What students typed that the scenario engine didn&apos;t understand. Add the missing words to{" "}
        <code>web/src/engine/lexicon.ts</code>.
      </p>
      {rows.length === 0 ? (
        <p className="text-sm text-neutral-500">Nothing yet.</p>
      ) : (
        <ul className="divide-y divide-neutral-200 rounded border border-neutral-200 text-sm dark:divide-neutral-800 dark:border-neutral-800">
          {rows.map((r) => (
            <li key={r.id} className="flex justify-between gap-4 px-3 py-2">
              <span dir="auto">{r.text}</span>
              <span className="shrink-0 text-neutral-500">
                {r.scenario} · {new Date(r.created_at).toLocaleDateString("en-GB")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
