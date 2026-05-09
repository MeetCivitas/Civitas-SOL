-- Civitas waitlist + newsletter subscribers
-- Run this once in your Supabase project (Dashboard → SQL Editor → New query).

create table if not exists public.waitlist (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,
  company     text,
  twitter     text,
  created_at  timestamptz not null default now()
);

-- Case-insensitive uniqueness so "Foo@Bar.com" and "foo@bar.com" collide.
create unique index if not exists waitlist_email_lower_unique
  on public.waitlist (lower(email));

-- Row Level Security: lock the table down, then allow anon-key inserts only.
alter table public.waitlist enable row level security;

-- Drop any prior policy with the same name (idempotent re-runs).
drop policy if exists "allow_anon_insert" on public.waitlist;
drop policy if exists "no_select" on public.waitlist;

-- Anyone (anon key from the API route) can insert a row.
create policy "allow_anon_insert"
  on public.waitlist
  for insert
  to anon, authenticated
  with check (true);

-- No one reads via the API. Use the Supabase dashboard or service-role key.
-- (Omitting a SELECT policy means SELECT is blocked under RLS.)
