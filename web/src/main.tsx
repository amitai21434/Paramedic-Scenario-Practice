import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { AuthProvider } from "./auth";
import { emailLink, supabase } from "./lib/supabase";
import "./index.css";

// Let Supabase finish reading any invite/reset token from the URL first, then
// send the user to the right screen before the router takes over the hash.
await supabase.auth.getSession();
if (emailLink.type === "invite" || emailLink.type === "recovery") {
  window.location.hash = "#/set-password";
} else if (emailLink.error) {
  window.location.hash = "#/login"; // Login shows emailLink.error
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>,
);
