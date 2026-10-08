import { useState, type FormEvent } from "react";
import { Navigate } from "react-router";
import { useAuth } from "../auth";
import { emailLink, supabase } from "../lib/supabase";

export default function Login() {
  const { session } = useAuth();
  const [mode, setMode] = useState<"signin" | "reset">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // e.g. "Email link is invalid or has expired" when arriving from an old invite/reset link
  const [error, setError] = useState(emailLink.error);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (session) return <Navigate to="/" replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    setNotice(null);
    if (mode === "signin") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setError("Invalid email or password.");
    } else {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + window.location.pathname,
      });
      // Same message either way, so this can't be used to probe which emails exist.
      if (error && error.status === 429) setError("Too many requests. Try again later.");
      else setNotice("If that email has an account, a reset link is on its way.");
    }
    setPending(false);
  }

  return (
    <main className="mx-auto w-full max-w-sm space-y-6 p-6 pt-16">
      <div className="space-y-3 text-center">
        <svg viewBox="0 0 120 40" className="mx-auto h-10 w-28 text-accent" aria-hidden>
          <path d="M0 22 H38 L44 10 L52 34 L60 2 L68 22 H120" fill="none" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
        <p className="text-sm font-semibold tracking-wide text-muted">Paramedic Scenario Practice</p>
      </div>
      <div className="card space-y-5 p-6">
      <h1 className="text-2xl font-bold">{mode === "signin" ? "Sign in" : "Reset password"}</h1>
      <form onSubmit={onSubmit} className="space-y-3">
        <input
          type="email"
          required
          autoComplete="email"
          placeholder="Email"
          className="input w-full"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        {mode === "signin" && (
          <input
            type="password"
            required
            autoComplete="current-password"
            placeholder="Password"
            className="input w-full"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        {notice && <p className="text-sm text-green-600">{notice}</p>}
        <button disabled={pending} className="btn w-full">
          {mode === "signin" ? (pending ? "Signing in…" : "Sign in") : "Send reset link"}
        </button>
      </form>
      <button
        className="text-sm text-neutral-500 hover:underline"
        onClick={() => {
          setMode(mode === "signin" ? "reset" : "signin");
          setError(null);
          setNotice(null);
        }}
      >
        {mode === "signin" ? "Forgot password?" : "Back to sign in"}
      </button>
      </div>
      <p className="text-center text-sm text-neutral-500">Access is by invitation only.</p>
    </main>
  );
}
