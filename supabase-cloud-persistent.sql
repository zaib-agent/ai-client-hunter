-- AI Client Hunter V9 — Cloud Persistent Autopilot + Reply Monitor
-- Run ONCE in Supabase SQL Editor.
-- Safe to re-run.

create table if not exists public.autopilot_jobs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  config jsonb not null default '{}'::jsonb,
  last_run_at timestamptz,
  last_result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists autopilot_jobs_enabled_idx
  on public.autopilot_jobs(enabled);

create table if not exists public.reply_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete cascade,
  message_key text not null unique,
  from_email text not null default '',
  subject text not null default '',
  reply_text text not null default '',
  interested boolean not null default false,
  confidence integer not null default 0 check (confidence between 0 and 100),
  summary text not null default '',
  suggested_reply text not null default '',
  processed_at timestamptz not null default now()
);

create index if not exists reply_events_user_processed_idx
  on public.reply_events(user_id, processed_at desc);

create index if not exists reply_events_lead_idx
  on public.reply_events(lead_id);

alter table public.autopilot_jobs enable row level security;
alter table public.reply_events enable row level security;

drop policy if exists "Users can read own autopilot job" on public.autopilot_jobs;
create policy "Users can read own autopilot job"
on public.autopilot_jobs for select to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can create own autopilot job" on public.autopilot_jobs;
create policy "Users can create own autopilot job"
on public.autopilot_jobs for insert to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can update own autopilot job" on public.autopilot_jobs;
create policy "Users can update own autopilot job"
on public.autopilot_jobs for update to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own autopilot job" on public.autopilot_jobs;
create policy "Users can delete own autopilot job"
on public.autopilot_jobs for delete to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can read own reply events" on public.reply_events;
create policy "Users can read own reply events"
on public.reply_events for select to authenticated
using (auth.uid() = user_id);

grant select, insert, update, delete on public.autopilot_jobs to authenticated;
grant select on public.reply_events to authenticated;

-- Make sure the existing notification/lead tables are available to authenticated users.
grant select, insert, update on public.notifications to authenticated;
grant select, insert, update, delete on public.leads to authenticated;
