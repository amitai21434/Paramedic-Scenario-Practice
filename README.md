# Paramedic Scenario Practice

Clinical-scenario practice tool for MDA paramedic students. Small and invite-only.

- **Frontend:** `web/` — Vite + React + TypeScript, hosted on GitHub Pages.
- **Backend:** `supabase/` — Postgres with Row Level Security, Supabase Auth, and one Edge Function (invites).

There is no server of our own and **no AI**. Scenarios run entirely in the browser.

## How scenarios work

The scenario engine (`web/src/engine/`) is deterministic: no model, no API costs, no daily limits.

1. **Case templates** (private content, see below) describe a clinical situation from the protocol book: the patient's states (rhythm, vitals, findings), how each state reacts to treatment or to time passing, which drugs are right or wrong, and a checklist.
2. **Generator** (`generate.ts`) rolls a unique patient from a template: variant (e.g. inferior MI with RV involvement), age, sex, weight, background, allergies, vitals within ranges, hidden facts (Viagra use, asthma…).
3. **Parser** (`parse.ts`, `lexicon.ts`) reads free Hebrew/English text — "מחברת מוניטור ונותנת אספירין 300 מ״ג בלעיסה" — into actions and doses. It ignores prefixes (ו/ה/ב/ל…), quotes and small typos. Unrecognized messages are logged for the admin.
4. **Engine** (`engine.ts`, `physiology.ts`) applies each action, advances a simulated clock, and fires the template's rules (deterioration, response to treatment). Physiology is enforced in one place: no pulse ⇒ no BP, no SpO2, GCS 3.
5. **ECG** (`ecg.ts`) draws rhythm strips and 12-leads; the student reads the rhythm — its name is never shown.
6. **Debrief** (`debrief.ts`) at the end: diagnosis, checklist with times, errors (wrong dose, contraindication, missed steps) and the protocols involved.

## Scenario content (private)

The case templates are derived from the protocol book, so they're **not** in this repo:

- Source files: `content/` (git-ignored) — `drugs.mjs` and `cases/*.mjs`. JS, so they can have comments and share pieces (`cases/shared.mjs`).
- In production the site reads them from the `scenario_content` table, which only signed-in users can read.
- The dev server serves them straight from `content/` (refresh to see edits).

**Back up `content/` yourself** (e.g. OneDrive) — git doesn't track it.

To publish content changes:

```bash
cd web
npm test                                                    # validates the content and plays scenarios
cd ..
node reference/upload-content.mjs                           # writes reference/out/content.sql
npx supabase db query --linked -f reference/out/content.sql # uploads it
```

## Local development

```bash
cd web
npm install
npm run dev        # http://localhost:5173
npm test           # engine + content tests
```

On the dev server, `http://localhost:5173/#/dev` runs scenarios without signing in (dev only — the route doesn't exist in the published site).

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
| `scenario_content` | Any signed-in user can read. Nobody can write from the app (uploaded with the CLI). |
| `unrecognized_inputs` | Users can add their own rows only. Admin reads all. |
| `reference_pieces` (split protocol book) | No app access (left from the AI phase). |
| `invite-user` function | Checks the caller is admin before sending the invite. |

Public signup is disabled (dashboard, and `enable_signup = false` in `supabase/config.toml`). New users only arrive by invite.

### Making someone admin

Run once in the Supabase SQL editor:

```sql
update public.profiles set role = 'admin' where email = '<email>';
```
