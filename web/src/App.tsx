import type { ReactNode } from "react";
import { HashRouter, Link, Navigate, Route, Routes } from "react-router";
import { useAuth } from "./auth";
import { supabase } from "./lib/supabase";
import Admin from "./pages/Admin";
import Chat from "./pages/Chat";
import Login from "./pages/Login";
import SetPassword from "./pages/SetPassword";

// HashRouter (#/chat) because GitHub Pages can't serve client-side routes on refresh.
export default function App() {
  return (
    <HashRouter>
      <Header />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/set-password" element={<RequireUser><SetPassword /></RequireUser>} />
        <Route path="/chat" element={<RequireUser><Chat /></RequireUser>} />
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
  if (admin && profile?.role !== "admin") return <Navigate to="/chat" replace />;
  return children;
}

function Home() {
  const { loading, session, profile } = useAuth();
  if (loading || (session && !profile)) return null;
  if (!session) return <Navigate to="/login" replace />;
  return <Navigate to={profile?.role === "admin" ? "/admin" : "/chat"} replace />;
}

function Header() {
  const { session, profile } = useAuth();
  if (!session || !profile) return null;
  return (
    <header className="border-b border-neutral-200 dark:border-neutral-800">
      <nav className="mx-auto flex max-w-3xl items-center gap-4 p-4 text-sm">
        <Link to="/chat" className="font-medium">Practice</Link>
        {profile.role === "admin" && <Link to="/admin">Admin</Link>}
        <span className="ml-auto text-neutral-500" dir="auto">{profile.name || profile.email}</span>
        <button className="hover:underline" onClick={() => supabase.auth.signOut()}>
          Sign out
        </button>
      </nav>
    </header>
  );
}
