-- Phase 1: user profiles with roles, and admin-only settings.
--
-- Security model: Row Level Security (RLS) is the enforcement point. The
-- browser talks to the database directly with the public anon key, so every
-- table must have RLS enabled and only the policies below grant access.

-- ---------------------------------------------------------------------------
-- Profiles (one row per auth user)
-- ---------------------------------------------------------------------------

create type public.app_role as enum ('admin', 'user');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  name text not null default '',
  role public.app_role not null default 'user',
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Users may only ever change their own display name. Role, email and id are
-- not writable from the browser at all (column-level privileges), so nobody
-- can promote themselves. Rows are created by the trigger below, never by clients.
revoke insert, update, delete on public.profiles from anon, authenticated;
grant update (name) on public.profiles to authenticated;

-- security definer so it can read profiles without recursing into RLS.
create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'admin'
  );
$$;

revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

create policy "Users read own profile; admin reads all"
  on public.profiles for select
  to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()));

create policy "Users update own name"
  on public.profiles for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- Create a profile whenever an auth user is created (including by invite).
-- Everyone starts as 'user'; the admin is promoted once, manually, via SQL.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'name', ''));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Settings (admin-editable key/value, e.g. the AI system instructions)
-- ---------------------------------------------------------------------------

create table public.settings (
  key text primary key,
  value text not null default '',
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);

alter table public.settings enable row level security;

revoke all on public.settings from anon;

-- Only the admin can read or write settings. Students can't even read the
-- instructions; the chat Edge Function reads them with the service role.
create policy "Admin full access to settings"
  on public.settings for all
  to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create function public.touch_settings()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := (select auth.uid());
  return new;
end;
$$;

create trigger settings_touch
  before update on public.settings
  for each row execute function public.touch_settings();

insert into public.settings (key, value) values ('system_instructions', '');
