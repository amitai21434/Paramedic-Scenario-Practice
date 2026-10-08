-- Full scenario transcripts, kept only for users the admin picks.
--
-- profiles.keep_transcripts: off by default. Only the admin can turn it on or
-- off (through set_keep_transcripts below); users can't change it themselves.
-- scenario_results.transcript: everything typed and answered in the run. The
-- insert policy rejects a transcript unless the user's switch is on, so the
-- check doesn't depend on the website behaving.

alter table public.profiles
  add column keep_transcripts boolean not null default false;

alter table public.scenario_results
  add column transcript jsonb check (transcript is null or octet_length(transcript::text) <= 200000);

-- Lets lists show which runs have a transcript without downloading it.
alter table public.scenario_results
  add column has_transcript boolean generated always as (transcript is not null) stored;

grant insert (transcript) on public.scenario_results to authenticated;

drop policy "Users add their own results" on public.scenario_results;
create policy "Users add their own results"
  on public.scenario_results for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and (
      transcript is null
      or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.keep_transcripts)
    )
  );

-- Admin-only switch, by email so it can be set right after sending an invite.
create function public.set_keep_transcripts(target_email text, keep boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Forbidden';
  end if;
  update public.profiles set keep_transcripts = keep where email = lower(trim(target_email));
  return found;
end;
$$;

revoke execute on function public.set_keep_transcripts(text, boolean) from public, anon;
grant execute on function public.set_keep_transcripts(text, boolean) to authenticated;
