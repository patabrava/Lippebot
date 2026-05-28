create extension if not exists pgcrypto;

create table if not exists public.conversation_sessions (
  id uuid primary key default gen_random_uuid(),
  session_id text not null unique,
  started_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  message_count integer not null default 0,
  final_mode text,
  final_collected_data jsonb not null default '{}'::jsonb,
  lead_person_id integer,
  lead_deal_id integer,
  support_person_id integer,
  support_note_status text,
  support_match_state text,
  support_intended_inbox text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.conversation_messages (
  id uuid primary key default gen_random_uuid(),
  session_id text not null references public.conversation_sessions(session_id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  turn_index integer not null,
  created_at timestamptz not null default now()
);

create table if not exists public.conversation_events (
  id uuid primary key default gen_random_uuid(),
  session_id text not null references public.conversation_sessions(session_id) on delete cascade,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists conversation_sessions_started_at_idx
  on public.conversation_sessions(started_at desc);

create index if not exists conversation_sessions_last_message_at_idx
  on public.conversation_sessions(last_message_at desc);

create index if not exists conversation_messages_session_turn_idx
  on public.conversation_messages(session_id, turn_index);

create index if not exists conversation_events_session_created_idx
  on public.conversation_events(session_id, created_at);

create index if not exists conversation_events_type_idx
  on public.conversation_events(event_type);

alter table public.conversation_sessions enable row level security;
alter table public.conversation_messages enable row level security;
alter table public.conversation_events enable row level security;
