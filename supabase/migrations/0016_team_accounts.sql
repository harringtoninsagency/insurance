-- Individual logins for agency staff. Staff are Supabase Auth users with a
-- `profiles` row (the same identity table every "agency scoped" RLS policy
-- already keys off) — invited by an admin from the /team page.

alter table public.profiles
  add column full_name text,
  add column active boolean not null default true;

-- A deactivated user must lose access to every agency-scoped table
-- immediately, not just when their JWT expires — so fold `active` into the
-- one function all of those policies resolve through.
create or replace function public.current_agency_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select agency_id from public.profiles where id = auth.uid() and active
$$;

-- "Is the caller an active admin" as a security-definer function so a policy
-- on `profiles` can use it without recursing into `profiles`' own RLS.
create or replace function public.is_agency_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and active
  )
$$;

-- Admins can see their whole team (everyone else still only sees their own
-- row, via the existing "profile: read own" policy). Writes (invite, role
-- change, deactivate) go through server actions using the service-role
-- client after an explicit admin check — there is deliberately no insert /
-- update policy for the browser-facing client.
create policy "profiles: admins read agency team" on public.profiles
  for select using (public.is_agency_admin() and agency_id = public.current_agency_id());
