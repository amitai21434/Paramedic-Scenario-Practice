-- Phase 4: history of finished scenarios, for the "my history / weak spots" page.
--
-- One row per finished scenario: the score and the debrief summary (checklist,
-- errors, warnings, complication). The chat transcript is not stored.
-- Students add, read and delete only their own rows; the admin reads everyone's.
-- Nobody can edit a row.

create table public.scenario_results (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  scenario text not null check (char_length(scenario) <= 100),
  title text not null check (char_length(title) <= 200),
  station text not null check (char_length(station) <= 50),
  score_done smallint not null check (score_done >= 0),
  score_total smallint not null check (score_total >= 0),
  critical_missed smallint not null check (critical_missed >= 0),
  duration_sec integer not null check (duration_sec >= 0),
  -- { checklist: [{ label, critical, done, late }], errors: [..], warnings: [..], complication: { title, resolved } | null }
  details jsonb not null check (octet_length(details::text) <= 32000),
  created_at timestamptz not null default now()
);

create index scenario_results_user_created on public.scenario_results (user_id, created_at desc);

alter table public.scenario_results enable row level security;
revoke all on public.scenario_results from anon, authenticated;
grant insert (user_id, scenario, title, station, score_done, score_total, critical_missed, duration_sec, details)
  on public.scenario_results to authenticated;
grant select, delete on public.scenario_results to authenticated;

create policy "Users add their own results"
  on public.scenario_results for insert
  to authenticated
  with check (user_id = (select auth.uid()));

create policy "Users read own results; admin reads all"
  on public.scenario_results for select
  to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));

create policy "Users delete their own results"
  on public.scenario_results for delete
  to authenticated
  using (user_id = (select auth.uid()));
