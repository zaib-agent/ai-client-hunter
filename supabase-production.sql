-- AI Client Hunter production database
-- Run this in Supabase SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  business_name text not null,
  industry text not null default '',
  location text not null default '',
  website text not null default '',
  likely_need text not null default '',
  reason text not null default '',
  suggested_service text not null default '',
  outreach_angle text not null default '',
  priority_score integer not null default 0 check (priority_score between 0 and 100),
  status text not null default 'Cold' check (status in ('Hot','Warm','Cold','Contacted','Replied','Won','Lost')),
  notes text not null default '',
  evidence jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists leads_user_id_idx on public.leads(user_id);
create index if not exists leads_user_created_idx on public.leads(user_id, created_at desc);
create index if not exists leads_user_website_idx on public.leads(user_id, website);

create or replace function public.set_leads_updated_at()
returns trigger
language plpgsql
security invoker
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists leads_updated_at on public.leads;
create trigger leads_updated_at
before update on public.leads
for each row execute function public.set_leads_updated_at();

alter table public.leads enable row level security;

-- Users can only read their own leads.
drop policy if exists "Users can read own leads" on public.leads;
create policy "Users can read own leads"
on public.leads for select
to authenticated
using (auth.uid() = user_id);

-- Users can only create leads for themselves.
drop policy if exists "Users can create own leads" on public.leads;
create policy "Users can create own leads"
on public.leads for insert
to authenticated
with check (auth.uid() = user_id);

-- Users can only update their own leads.
drop policy if exists "Users can update own leads" on public.leads;
create policy "Users can update own leads"
on public.leads for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- Users can only delete their own leads.
drop policy if exists "Users can delete own leads" on public.leads;
create policy "Users can delete own leads"
on public.leads for delete
to authenticated
using (auth.uid() = user_id);

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.leads to authenticated;

-- Verification query:
-- select id, user_id, business_name, priority_score, status, created_at from public.leads order by created_at desc;
