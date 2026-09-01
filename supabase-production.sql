-- ============================================================
-- AI CLIENT HUNTER
-- PRODUCTION SUPABASE DATABASE
-- ============================================================

create extension if not exists pgcrypto;


-- ============================================================
-- LEADS TABLE
-- ============================================================

create table if not exists public.leads (
    id uuid primary key default gen_random_uuid(),

    user_id uuid not null
        references auth.users(id)
        on delete cascade,

    business_name text not null,
    website text,
    location text,
    industry text,
    service text,

    priority_score integer not null default 0,

    status text not null default 'Cold'
        check (
            status in (
                'Hot',
                'Warm',
                'Cold',
                'Contacted',
                'Replied',
                'Won',
                'Lost'
            )
        ),

    description text,
    pain_points jsonb not null default '[]'::jsonb,
    opportunities jsonb not null default '[]'::jsonb,

    evidence jsonb not null default '[]'::jsonb,

    notes text,

    outreach_channel text,
    outreach_text text,

    source_count integer not null default 0,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);


-- ============================================================
-- INDEXES
-- ============================================================

create index if not exists leads_user_id_idx
on public.leads(user_id);

create index if not exists leads_created_at_idx
on public.leads(created_at desc);

create index if not exists leads_status_idx
on public.leads(status);

create index if not exists leads_priority_score_idx
on public.leads(priority_score desc);

create index if not exists leads_website_idx
on public.leads(website);


-- ============================================================
-- UPDATED_AT TRIGGER
-- ============================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;


drop trigger if exists leads_set_updated_at
on public.leads;

create trigger leads_set_updated_at
before update on public.leads
for each row
execute function public.set_updated_at();


-- ============================================================
-- ENABLE RLS
-- ============================================================

alter table public.leads enable row level security;


-- ============================================================
-- REMOVE OLD POLICIES
-- ============================================================

drop policy if exists
"Users can view their own leads"
on public.leads;

drop policy if exists
"Users can insert their own leads"
on public.leads;

drop policy if exists
"Users can update their own leads"
on public.leads;

drop policy if exists
"Users can delete their own leads"
on public.leads;


-- ============================================================
-- SELECT POLICY
-- ============================================================

create policy
"Users can view their own leads"

on public.leads

for select

to authenticated

using (
    auth.uid() = user_id
);


-- ============================================================
-- INSERT POLICY
-- ============================================================

create policy
"Users can insert their own leads"

on public.leads

for insert

to authenticated

with check (
    auth.uid() = user_id
);


-- ============================================================
-- UPDATE POLICY
-- ============================================================

create policy
"Users can update their own leads"

on public.leads

for update

to authenticated

using (
    auth.uid() = user_id
)

with check (
    auth.uid() = user_id
);


-- ============================================================
-- DELETE POLICY
-- ============================================================

create policy
"Users can delete their own leads"

on public.leads

for delete

to authenticated

using (
    auth.uid() = user_id
);


-- ============================================================
-- GRANTS
-- ============================================================

grant usage on schema public to authenticated;

grant
select,
insert,
update,
delete
on public.leads
to authenticated;


-- ============================================================
-- AUTH PROFILE VIEW
-- ============================================================
-- Safe user information for authenticated users.
-- No passwords or secrets are exposed.

create or replace view public.my_profile
with (security_invoker = true)
as
select
    id,
    email,
    created_at
from auth.users
where id = auth.uid();


grant select
on public.my_profile
to authenticated;


-- ============================================================
-- FINAL CHECK
-- ============================================================

select
    'AI Client Hunter production database ready'
    as status;