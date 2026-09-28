-- Phase 2: reference material, conversations, and hidden scenario state.

-- ---------------------------------------------------------------------------
-- Protocol book, split into pieces by reference/split-protocols.mjs.
-- No policies: only the chat Edge Function (service role) can read it.
-- ---------------------------------------------------------------------------
create table public.reference_pieces (
  id text primary key,            -- e.g. "03-11", or "08-09-1" for a part
  chapter int not null,
  chapter_title text not null,
  title text not null,
  part text,                      -- e.g. "1/2" when a protocol was split
  page_from int,
  page_to int,
  est_tokens int not null,
  drugs text[] not null default '{}',   -- chapter-10 titles this piece mentions
  skills text[] not null default '{}',  -- chapter-9 titles this piece mentions
  body text not null
);

alter table public.reference_pieces enable row level security;
revoke all on public.reference_pieces from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Conversations: one active (non-archived) per user for now. "New scenario"
-- archives the current one, so past scenarios are kept.
-- ---------------------------------------------------------------------------
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  archived_at timestamptz
);

create unique index conversations_one_active_per_user
  on public.conversations (user_id) where archived_at is null;

alter table public.conversations enable row level security;
revoke insert, update, delete on public.conversations from anon, authenticated;

create policy "Users read own conversations"
  on public.conversations for select
  to authenticated
  using (user_id = (select auth.uid()));

create table public.messages (
  id bigint generated always as identity primary key,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

create index messages_conversation_idx on public.messages (conversation_id, id);

alter table public.messages enable row level security;
-- Messages are only ever written by the chat function (service role).
revoke insert, update, delete on public.messages from anon, authenticated;

create policy "Users read messages of own conversations"
  on public.messages for select
  to authenticated
  using (exists (
    select 1 from public.conversations c
    where c.id = conversation_id and c.user_id = (select auth.uid())
  ));

-- ---------------------------------------------------------------------------
-- Which station/protocols the AI chose for a conversation. Hidden from the
-- student (it would reveal the diagnosis) — service role only.
-- ---------------------------------------------------------------------------
create table public.scenario_state (
  conversation_id uuid primary key references public.conversations (id) on delete cascade,
  station text not null,
  piece_ids text[] not null,
  created_at timestamptz not null default now()
);

alter table public.scenario_state enable row level security;
revoke all on public.scenario_state from anon, authenticated;

-- ---------------------------------------------------------------------------
-- New admin settings.
-- ---------------------------------------------------------------------------
insert into public.settings (key, value) values
  ('scenario_examples', ''),            -- past real exam scenarios, style examples only
  ('model', 'gemini-3.5-flash-lite')    -- which AI model the chat uses
on conflict (key) do nothing;
