import type { ReactNode } from "react";
import { HashRouter, Navigate, NavLink, Route, Routes } from "react-router";
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

function Tab({ to, children }: { to: string; children: ReactNode }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `rounded-md px-3 py-1.5 font-medium transition ${isActive ? "bg-panel-2 text-ink shadow-[inset_0_-2px_0_var(--color-accent)]" : "text-muted hover:text-ink"}`
      }
    >
      {children}
    </NavLink>
  );
}

function Header() {
  const { session, profile } = useAuth();
  if (!session || !profile) return null;
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur">
      <nav className="mx-auto flex max-w-6xl items-center gap-1 px-4 py-2.5 text-sm">
        <Tab to="/practice">Practice</Tab>
        <Tab to="/history">History</Tab>
        {profile.role === "admin" && <Tab to="/admin">Admin</Tab>}
        <span className="ml-auto text-muted" dir="auto">{profile.name || profile.email}</span>
        <button className="ms-3 rounded-md px-2 py-1 text-muted transition hover:bg-panel-2 hover:text-ink" onClick={() => supabase.auth.signOut()}>
          Sign out
        </button>
      </nav>
    </header>
  );
}
