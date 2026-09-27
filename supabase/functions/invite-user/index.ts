// Admin-only: sends a Supabase invite email to a new user.
//
// Public signup is disabled on the project, so this is the only way new
// accounts get created. The admin check happens here, server-side, against
// the database — the frontend hiding the invite form is just UI.

import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    if (req.method !== "POST") {
      return Response.json({ error: "Method not allowed" }, { status: 405 });
    }

    const { data: caller } = await ctx.supabaseAdmin
      .from("profiles")
      .select("role")
      .eq("id", ctx.userClaims!.id)
      .single();
    if (caller?.role !== "admin") {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const email = String(body.email ?? "").trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      return Response.json({ error: "Enter a valid email address." }, { status: 400 });
    }

    // The invite link lands back on the frontend the admin is using
    // (localhost in dev, GitHub Pages in production). Must be in the
    // project's allowed Redirect URLs.
    const redirectTo = req.headers.get("origin") ?? undefined;

    const { error } = await ctx.supabaseAdmin.auth.admin.inviteUserByEmail(email, {
      redirectTo,
    });
    if (error) {
      const alreadyExists = /already.*(registered|exists)/i.test(error.message);
      return Response.json(
        { error: alreadyExists ? "A user with that email already exists." : error.message },
        { status: alreadyExists ? 409 : 500 },
      );
    }

    return Response.json({ ok: true });
  }),
};
