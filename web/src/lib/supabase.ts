import { createClient } from "@supabase/supabase-js";

// Invite and password-reset emails send the user back here with the result in
// the URL hash (#access_token=...&type=invite, or #error=...). The app also
// uses the hash for routing (#/practice), so capture what the email link carried
// before the Supabase client consumes it and the router rewrites it.
const hash = new URLSearchParams(window.location.hash.slice(1));
export const emailLink = {
  type: hash.get("access_token") ? hash.get("type") : null, // "invite" | "recovery" | ...
  error: hash.get("error_description"),
};

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
);

export type Profile = {
  id: string;
  email: string;
  name: string;
  role: "admin" | "user";
};
