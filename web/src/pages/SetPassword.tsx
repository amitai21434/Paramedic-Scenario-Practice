import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "../auth";
import { supabase } from "../lib/supabase";

const MIN_LENGTH = 10;

// Landing page for invite links (new user: name + password) and
// password-reset links (existing user: new password only).
export default function SetPassword() {
  const { profile, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const needsName = !profile?.name;
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (password.length < MIN_LENGTH) return setError(`Password must be at least ${MIN_LENGTH} characters.`);
    if (password !== confirm) return setError("Passwords don't match.");
    setPending(true);
    setError(null);

    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setPending(false);
      return setError(error.message);
    }
    if (needsName) {
      await supabase.from("profiles").update({ name: name.trim() }).eq("id", profile!.id);
      await refreshProfile();
    }
    navigate("/", { replace: true });
  }

  return (
    <main className="mx-auto w-full max-w-sm space-y-6 p-6 pt-20">
      <h1 className="text-2xl font-semibold">{needsName ? "Create your account" : "Set a new password"}</h1>
      <p className="text-sm text-neutral-500">{profile?.email}</p>
      <form onSubmit={onSubmit} className="space-y-3">
        {needsName && (
          <input
            required
            autoComplete="name"
            placeholder="Your name"
            dir="auto"
            className="input w-full"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        )}
        <input
          type="password"
          required
          autoComplete="new-password"
          placeholder={`Password (min ${MIN_LENGTH} characters)`}
          className="input w-full"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <input
          type="password"
          required
          autoComplete="new-password"
          placeholder="Confirm password"
          className="input w-full"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button disabled={pending} className="btn w-full">
          {pending ? "Saving…" : "Save"}
        </button>
      </form>
    </main>
  );
}
