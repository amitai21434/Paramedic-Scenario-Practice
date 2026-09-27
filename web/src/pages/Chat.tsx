import { useAuth } from "../auth";

// Placeholder — chat UI, per-user history and the model backend are phase 2.
export default function Chat() {
  const { profile } = useAuth();
  return (
    <main className="mx-auto w-full max-w-3xl p-6">
      <h1 className="text-2xl font-semibold">Scenario practice</h1>
      <p className="mt-2 text-neutral-500" dir="auto">
        Hi {profile?.name} — the chat isn&apos;t built yet.
      </p>
    </main>
  );
}
