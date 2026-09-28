import { FunctionsHttpError } from "@supabase/supabase-js";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { supabase, type Profile } from "../lib/supabase";

// Everything here is also enforced server-side: RLS only lets the admin read
// or write `settings` and read all profiles, and the invite-user function
// re-checks the caller's role.
export default function Admin() {
  return (
    <main className="mx-auto w-full max-w-3xl space-y-10 p-6">
      <ModelPicker />
      <SettingEditor
        settingKey="system_instructions"
        title="System instructions"
        description="Sent with every chat message. Changes apply immediately."
        rows={16}
        heading
      />
      <SettingEditor
        settingKey="scenario_examples"
        title="Exam scenario examples"
        description="Real past exam scenarios. The AI uses them only as examples of style and difficulty when inventing a new scenario — never copies them."
        rows={10}
      />
      <Invite />
      <Users />
    </main>
  );
}

const MODELS = [
  { value: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash Lite — free, ~500 requests/day" },
  { value: "gemini-3.8-flash", label: "Gemini 3.8 Flash — stronger, free tier only 20 requests/day" },
  { value: "stub", label: "Test mode — no AI, shows which book pages would be sent" },
];

function ModelPicker() {
  const [model, setModel] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    supabase
      .from("settings")
      .select("value")
      .eq("key", "model")
      .single()
      .then(({ data }) => setModel(data?.value ?? null));
  }, []);

  async function change(value: string) {
    setModel(value);
    setSaved(false);
    const { error } = await supabase.from("settings").update({ value }).eq("key", "model");
    setSaved(!error);
  }

  return (
    <section className="space-y-2">
      <h2 className="text-xl font-semibold">AI model</h2>
      <div className="flex items-center gap-3">
        <select
          value={model ?? ""}
          disabled={model === null}
          onChange={(e) => change(e.target.value)}
          className="input"
        >
          {model !== null && !MODELS.some((m) => m.value === model) && <option value={model}>{model}</option>}
          {MODELS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
        {saved && <span className="text-sm text-green-600">Saved — applies to the next message.</span>}
      </div>
    </section>
  );
}

function SettingEditor(props: {
  settingKey: string;
  title: string;
  description: string;
  rows: number;
  heading?: boolean;
}) {
  const { settingKey } = props;
  const [text, setText] = useState("");
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "idle" | "saving" | "saved" | "error">("loading");

  useEffect(() => {
    supabase
      .from("settings")
      .select("value, updated_at")
      .eq("key", settingKey)
      .single()
      .then(({ data, error }) => {
        if (error) return setStatus("error");
        setText(data.value);
        setUpdatedAt(data.updated_at);
        setStatus("idle");
      });
  }, [settingKey]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setStatus("saving");
    const { data, error } = await supabase
      .from("settings")
      .update({ value: text })
      .eq("key", settingKey)
      .select("updated_at")
      .single();
    if (error) return setStatus("error");
    setUpdatedAt(data.updated_at);
    setStatus("saved");
  }

  const Title = props.heading ? "h1" : "h2";
  return (
    <section className="space-y-3">
      <Title className={props.heading ? "text-2xl font-semibold" : "text-xl font-semibold"}>{props.title}</Title>
      <p className="text-sm text-neutral-500">
        {props.description}
        {updatedAt && <> Last saved {new Date(updatedAt).toLocaleString("en-GB")}.</>}
      </p>
      <form onSubmit={save} className="space-y-2">
        <textarea
          rows={props.rows}
          dir="auto"
          disabled={status === "loading"}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (status === "saved") setStatus("idle");
          }}
          className="w-full rounded border border-neutral-300 bg-transparent p-3 font-mono text-sm dark:border-neutral-700"
        />
        <div className="flex items-center gap-3">
          <button disabled={status === "loading" || status === "saving"} className="btn">
            {status === "saving" ? "Saving…" : "Save"}
          </button>
          {status === "saved" && <span className="text-sm text-green-600">Saved.</span>}
          {status === "error" && <span className="text-sm text-red-600">Couldn&apos;t load or save.</span>}
        </div>
      </form>
    </section>
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
