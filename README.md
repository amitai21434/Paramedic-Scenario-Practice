# Paramedic Scenario Practice

Clinical-scenario practice tool for MDA paramedic students. Small and invite-only.

- **Frontend:** `web/` — Vite + React + TypeScript, hosted on GitHub Pages.
- **Backend:** `supabase/` — Postgres with Row Level Security, Supabase Auth, and Edge Functions.

There is no server of our own. The browser talks to Supabase directly with the public anon key; what each user can read or write is enforced by RLS policies in the database, and privileged actions (invites, and later AI calls) run in Edge Functions.

## Local development

```bash
cd web
npm install
npm run dev        # http://localhost:5173
```

`web/.env` holds the Supabase URL and anon key. Both are public by design. **Never put the service_role / secret key anywhere in `web/`.**

## Database and functions

Migrations live in `supabase/migrations/`, functions in `supabase/functions/`.

```bash
npx supabase login
npx supabase link --project-ref twhrkgnetwdsqzsvekqk
npx supabase migration new <name>                       # create a migration
npx supabase db push                                    # apply migrations
npx supabase functions deploy <name> --use-api          # deploy a function
```

## Security model

| Data | Access |
| --- | --- |
| `profiles` | Users read their own row and may change only their `name`. Admin reads all. Nobody can change a `role` from the app. |
| `settings` (system instructions) | Admin only. Students can't read it. |
| `invite-user` function | Checks the caller is admin before sending the invite. |

Public signup is disabled (dashboard, and `enable_signup = false` in `supabase/config.toml`). New users only arrive by invite.

### Making someone admin

Run once in the Supabase SQL editor:

```sql
update public.profiles set role = 'admin' where email = '<email>';
```
