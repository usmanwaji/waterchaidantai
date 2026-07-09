-- ============================================================================
-- waterchaidantai — Membership + Flood Reports schema
-- Run this once in Supabase: Dashboard → SQL Editor → New query → paste → Run
-- Safe to re-run (uses IF NOT EXISTS / OR REPLACE / DROP POLICY IF EXISTS).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0) Extensions
-- ---------------------------------------------------------------------------
create extension if not exists pgcrypto;   -- gen_random_uuid()
create extension if not exists pg_net;     -- net.http_post(), used to call the
                                            -- notify-admin Edge Function below

-- ---------------------------------------------------------------------------
-- 1) profiles — one row per signed-up user, auto-created on first Google sign-in
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text not null,
  full_name    text,
  phone        text,
  role         text not null default 'user'    check (role in ('user','admin')),
  status       text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at   timestamptz not null default now(),
  approved_at  timestamptz,
  approved_by  uuid references auth.users(id)
);

comment on table public.profiles is
  'One row per authenticated user. status=pending until an admin approves them on admin.html; only approved users may insert flood_reports.';

-- Auto-create a profile row (status=pending) whenever someone signs in for the first time.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', new.email)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- 2) flood_reports — one row per reported flooded road point
-- ---------------------------------------------------------------------------
create table if not exists public.flood_reports (
  id             uuid primary key default gen_random_uuid(),
  lat            double precision not null check (lat between -90 and 90),
  lon            double precision not null check (lon between -180 and 180),
  road_name      text,
  depth_cm       numeric not null check (depth_cm >= 0 and depth_cm <= 500),
  reported_at    timestamptz not null default now(),
  reporter_name  text not null,
  reporter_phone text not null,
  status         text not null default 'active' check (status in ('active','cleared')),
  created_by     uuid references auth.users(id),
  created_at     timestamptz not null default now()
);

comment on table public.flood_reports is
  'Flooded-road points shown on route.html and used to check routes against vehicle safe-depth thresholds.';

create index if not exists flood_reports_status_idx on public.flood_reports (status);
create index if not exists flood_reports_reported_at_idx on public.flood_reports (reported_at desc);

-- ---------------------------------------------------------------------------
-- 3) Helper functions used inside RLS policies (security definer avoids
--    infinite-recursion when a policy on `profiles` needs to read `profiles`)
-- ---------------------------------------------------------------------------
create or replace function public.is_admin(uid uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles where id = uid and role = 'admin'
  );
$$;

create or replace function public.is_approved(uid uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles where id = uid and status = 'approved'
  );
$$;

-- ---------------------------------------------------------------------------
-- 4) Row Level Security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.flood_reports enable row level security;

-- profiles: a user can read their own row; admins can read everyone's
drop policy if exists "profiles_select_own_or_admin" on public.profiles;
create policy "profiles_select_own_or_admin"
  on public.profiles for select
  using (id = auth.uid() or public.is_admin(auth.uid()));

-- profiles: only admins may change role/status (approve/reject/revoke)
drop policy if exists "profiles_update_admin_only" on public.profiles;
create policy "profiles_update_admin_only"
  on public.profiles for update
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- (no insert policy needed — rows are created only by the handle_new_user
--  trigger, which runs as security definer and bypasses RLS)

-- flood_reports: anyone (including anonymous visitors) can read active + cleared
-- reports — the map/routing feature must work for the general public, only
-- *submitting* reports is restricted.
drop policy if exists "flood_reports_select_public" on public.flood_reports;
create policy "flood_reports_select_public"
  on public.flood_reports for select
  using (true);

-- flood_reports: only approved, signed-in users may submit new reports
drop policy if exists "flood_reports_insert_approved" on public.flood_reports;
create policy "flood_reports_insert_approved"
  on public.flood_reports for insert
  with check (public.is_approved(auth.uid()) and created_by = auth.uid());

-- flood_reports: the original reporter (e.g. to mark "cleared") or an admin may update
drop policy if exists "flood_reports_update_own_or_admin" on public.flood_reports;
create policy "flood_reports_update_own_or_admin"
  on public.flood_reports for update
  using (created_by = auth.uid() or public.is_admin(auth.uid()))
  with check (created_by = auth.uid() or public.is_admin(auth.uid()));

-- flood_reports: only admins may delete
drop policy if exists "flood_reports_delete_admin" on public.flood_reports;
create policy "flood_reports_delete_admin"
  on public.flood_reports for delete
  using (public.is_admin(auth.uid()));

-- ---------------------------------------------------------------------------
-- 5) Notify admin by email when a new user signs up (status defaults to pending)
--    Fill in the two placeholders below AFTER you deploy the notify-admin
--    Edge Function (see SETUP-GUIDE.md step 5). Re-run just this block to
--    update them later if needed.
-- ---------------------------------------------------------------------------
create or replace function public.notify_admin_new_signup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'pending' then
    perform net.http_post(
      url     := 'https://YOUR-PROJECT-REF.supabase.co/functions/v1/notify-admin',
      headers := jsonb_build_object(
                   'Content-Type', 'application/json',
                   'x-webhook-secret', 'YOUR-SHARED-SECRET'
                 ),
      body    := jsonb_build_object(
                   'id', new.id,
                   'email', new.email,
                   'name', new.full_name,
                   'created_at', new.created_at
                 )
    );
  end if;
  return new;
end;
$$;

drop trigger if exists on_profile_pending_notify on public.profiles;
create trigger on_profile_pending_notify
  after insert on public.profiles
  for each row execute function public.notify_admin_new_signup();

-- ---------------------------------------------------------------------------
-- 6) Bootstrap the first admin
--    Run this ONCE, AFTER newusmanwaji@gmail.com has signed in at least once
--    (so the profiles row exists). See SETUP-GUIDE.md step 7.
-- ---------------------------------------------------------------------------
-- update public.profiles
--   set role = 'admin', status = 'approved', approved_at = now()
--   where email = 'newusmanwaji@gmail.com';
