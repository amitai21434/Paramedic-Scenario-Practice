import { FunctionsHttpError } from "@supabase/supabase-js";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { percent, weakSpots, type ResultRow } from "../lib/history";
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
      setResult({ ok: true, message: `Invite sent to ${email}.` });
      setEmail("");
    }
    setPending(false);
  }

  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold">Invite a user</h2>
      <form onSubmit={onSubmit} className="flex gap-2">
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
      </form>
      {result && (
        <p className={`text-sm ${result.ok ? "text-green-600" : "text-red-600"}`}>{result.message}</p>
      )}
    </section>
  );
}

function Users() {
  const [users, setUsers] = useState<Profile[]>([]);
  const load = useCallback(async () => {
    const { data } = await supabase
      .from("profiles")
      .select("id, email, name, role")
      .order("created_at");
    setUsers(data ?? []);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold">Users</h2>
      <ul className="divide-y divide-neutral-200 rounded border border-neutral-200 text-sm dark:divide-neutral-800 dark:border-neutral-800">
        {users.map((u) => (
          <li key={u.id} className="flex justify-between gap-4 px-3 py-2">
            <span dir="auto">
              {u.name || <em className="text-neutral-500">invite pending</em>}{" "}
              <span className="text-neutral-500">{u.email}</span>
            </span>
            <span className="text-neutral-500">{u.role}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

type AdminResultRow = ResultRow & { profiles: { name: string; email: string } | null };

/** Everyone's finished scenarios, and what the whole group misses most. */
function Results() {
  const [rows, setRows] = useState<AdminResultRow[]>([]);
  useEffect(() => {
    supabase
      .from("scenario_results")
      .select("*, profiles(name, email)")
      .order("created_at", { ascending: false })
      .limit(1000)
      .then(({ data }) => setRows((data ?? []) as AdminResultRow[]));
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
              <li key={r.id} className="flex justify-between gap-4 px-3 py-2">
                <span dir="auto">
                  {r.profiles?.name || r.profiles?.email} — {r.title}
                </span>
                <span className="shrink-0 text-neutral-500">
                  {percent(r)}% · {new Date(r.created_at).toLocaleDateString("en-GB")}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
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
