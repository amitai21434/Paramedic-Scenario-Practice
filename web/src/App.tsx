import type { ReactNode } from "react";
import { HashRouter, Link, Navigate, Route, Routes } from "react-router";
import { useAuth } from "./auth";
import { supabase } from "./lib/supabase";
import Admin from "./pages/Admin";
import History from "./pages/History";
import Login from "./pages/Login";
import Practice from "./pages/Practice";
import SetPassword from "./pages/SetPassword";

// HashRouter (#/practice) because GitHub Pages can't serve client-side routes on refresh.
export default function App() {
  return (
    <HashRouter>
      <Header />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/set-password" element={<RequireUser><SetPassword /></RequireUser>} />
        <Route path="/practice" element={<RequireUser><Practice /></RequireUser>} />
        <Route path="/history" element={<RequireUser><History /></RequireUser>} />
        {/* Dev server only: try scenarios without signing in (content comes from the local folder). */}
        {import.meta.env.DEV && <Route path="/dev" element={<Practice />} />}
        <Route path="/admin" element={<RequireUser admin><Admin /></RequireUser>} />
        <Route path="*" element={<Home />} />
      </Routes>
    </HashRouter>
  );
}

// Route guards are UX only — RLS/Edge Functions are what actually block access.
function RequireUser({ admin = false, children }: { admin?: boolean; children: ReactNode }) {
  const { loading, session, profile } = useAuth();
  if (loading || (session && !profile)) return <p className="p-6 text-neutral-500">Loading…</p>;
  if (!session) return <Navigate to="/login" replace />;
  if (admin && profile?.role !== "admin") return <Navigate to="/practice" replace />;
  return children;
}

function Home() {
  const { loading, session, profile } = useAuth();
  if (loading || (session && !profile)) return null;
  if (!session) return <Navigate to="/login" replace />;
  return <Navigate to={profile?.role === "admin" ? "/admin" : "/practice"} replace />;
}

function Header() {
  const { session, profile } = useAuth();
  if (!session || !profile) return null;
  return (
    <header className="border-b border-neutral-200 dark:border-neutral-800">
      <nav className="mx-auto flex max-w-5xl items-center gap-4 p-4 text-sm">
        <Link to="/practice" className="font-medium">Practice</Link>
        <Link to="/history">History</Link>
        {profile.role === "admin" && <Link to="/admin">Admin</Link>}
        <span className="ml-auto text-neutral-500" dir="auto">{profile.name || profile.email}</span>
        <button className="hover:underline" onClick={() => supabase.auth.signOut()}>
          Sign out
        </button>
      </nav>
    </header>
  );
}
