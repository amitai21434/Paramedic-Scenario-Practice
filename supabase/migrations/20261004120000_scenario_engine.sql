-- Phase 3: replace the AI chat with the in-browser scenario engine.
--
-- The scenarios now run entirely in the browser. The database only stores the
-- private scenario content (readable by signed-in users only) and a log of
-- messages the engine didn't understand (so its vocabulary can be extended).

-- ---------------------------------------------------------------------------
-- Remove the AI chat.
-- ---------------------------------------------------------------------------
drop table if exists public.scenario_state;
drop table if exists public.messages;
drop table if exists public.conversations;

delete from public.settings where key in ('system_instructions', 'scenario_examples', 'model');

-- ---------------------------------------------------------------------------
-- Scenario content: one JSON bundle (cases, drug rules, protocol titles),
-- uploaded from the private content/ folder with reference/upload-content.mjs.
-- Signed-in users can read it; nobody can write it from the app.
-- ---------------------------------------------------------------------------
create table public.scenario_content (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.scenario_content enable row level security;
revoke all on public.scenario_content from anon, authenticated;
grant select on public.scenario_content to authenticated;

create policy "Signed-in users read scenario content"
  on public.scenario_content for select
  to authenticated
  using (true);

-- ---------------------------------------------------------------------------
-- What students typed that the engine didn't understand. Students can only
-- add their own rows; only the admin can read them.
-- ---------------------------------------------------------------------------
create table public.unrecognized_inputs (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  text text not null check (char_length(text) <= 500),
  scenario text not null default '' check (char_length(scenario) <= 100),
  created_at timestamptz not null default now()
);

alter table public.unrecognized_inputs enable row level security;
revoke all on public.unrecognized_inputs from anon, authenticated;
grant insert (user_id, text, scenario) on public.unrecognized_inputs to authenticated;
grant select on public.unrecognized_inputs to authenticated;

create policy "Users log their own unrecognized input"
  on public.unrecognized_inputs for insert
  to authenticated
  with check (user_id = (select auth.uid()));

create policy "Admin reads unrecognized input"
  on public.unrecognized_inputs for select
  to authenticated
  using ((select public.is_admin()));
