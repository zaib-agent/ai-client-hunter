-- AI Client Hunter — Autopilot + Outreach + Reply Handoff
-- Run once in Supabase SQL Editor.
-- Safe to re-run because columns/policies/tables use IF NOT EXISTS / DROP POLICY IF EXISTS.

alter table if exists public.leads
  add column if not exists contact_email text not null default '';

alter table if exists public.leads
  add column if not exists outreach_subject text not null default '';

alter table if exists public.leads
  add column if not exists outreach_body text not null default '';

alter table if exists public.leads
  add column if not exists last_contacted_at timestamptz;

alter table if exists public.leads
  add column if not exists evidence jsonb not null default '[]'::jsonb;

create index if not exists leads_user_contact_email_idx
  on public.leads(user_id, contact_email);

create table if not exists public.outreach_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete cascade,
  recipient_email text not null,
  subject text not null default '',
  body text not null default '',
  provider_id text,
  sent_at timestamptz not null default now()
);

create index if not exists outreach_log_user_sent_idx
  on public.outreach_log(user_id, sent_at desc);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete cascade,
  type text not null default 'reply',
  title text not null default '',
  message text not null default '',
  from_email text not null default '',
  subject text not null default '',
  reply_text text not null default '',
  confidence integer not null default 0 check (confidence between 0 and 100),
  read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_created_idx
  on public.notifications(user_id, created_at desc);

alter table if exists public.leads enable row level security;
alter table public.outreach_log enable row level security;
alter table public.notifications enable row level security;

drop policy if exists "Users can read own leads" on public.leads;
create policy "Users can read own leads"
on public.leads for select to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can create own leads" on public.leads;
create policy "Users can create own leads"
on public.leads for insert to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can update own leads" on public.leads;
create policy "Users can update own leads"
on public.leads for update to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own leads" on public.leads;
create policy "Users can delete own leads"
on public.leads for delete to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can read own outreach" on public.outreach_log;
create policy "Users can read own outreach"
on public.outreach_log for select to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can create own outreach" on public.outreach_log;
create policy "Users can create own outreach"
on public.outreach_log for insert to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can read own notifications" on public.notifications;
create policy "Users can read own notifications"
on public.notifications for select to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can update own notifications" on public.notifications;
create policy "Users can update own notifications"
on public.notifications for update to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can create own notifications" on public.notifications;
create policy "Users can create own notifications"
on public.notifications for insert to authenticated
with check (auth.uid() = user_id);

grant select, insert, update, delete on public.leads to authenticated;
grant select, insert on public.outreach_log to authenticated;
grant select, insert, update on public.notifications to authenticated;
