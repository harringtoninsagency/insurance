-- Partner portal, stage 1: schema for restricted realtor/mortgage-broker
-- accounts and the quote-request intake queue they (and the public
-- quote-request page) submit into.
--
-- Deliberately NOT modeled as a `profiles` row: `current_agency_id()` (and
-- every "agency scoped" policy built on it) resolves from `profiles`, so
-- giving a partner one would silently hand them full internal access to
-- every table in the app. Partner accounts are a wholly separate identity
-- table with their own resolver function, and every partner-facing RLS
-- policy below is additive (a new SELECT policy only widens what a partner
-- can see; it never touches or loosens the existing agency-scoped policies
-- producers/admins rely on).

create table public.partner_accounts (
  id uuid primary key default gen_random_uuid(),
  -- Null until the invited person actually completes signup.
  user_id uuid unique references auth.users (id) on delete cascade,
  agency_id uuid not null references public.agencies (id) on delete cascade,
  contact_id uuid not null references public.industry_contacts (id) on delete cascade,
  status text not null default 'invited' check (status in ('invited', 'active', 'disabled')),
  invited_by uuid references public.profiles (id),
  invited_at timestamptz not null default now(),
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  unique (agency_id, contact_id)
);

create index partner_accounts_user_id_idx on public.partner_accounts (user_id);

-- Resolves the calling user's linked directory contact, when they're a
-- logged-in, active partner (not an internal producer/admin — those have no
-- partner_accounts row at all, so this returns null for them).
create function public.current_partner_contact_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select contact_id from public.partner_accounts where user_id = auth.uid() and status = 'active'
$$;

alter table public.partner_accounts enable row level security;

-- A partner may read their own account row (e.g. to show "logged in as X" in
-- the portal); everything else about this table stays service-role only.
create policy "partner_accounts: self read" on public.partner_accounts
  for select using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Quote request intake
-- ---------------------------------------------------------------------------

-- Deliberately separate from `properties`/`quotes` rather than letting an
-- external submission write into those directly, even RLS-scoped: a request
-- is just raw, unverified input until the processing pipeline (service-role,
-- run by a producer or the scheduled routine) matches or creates the real
-- property and links it back here.
create table public.quote_requests (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  -- Set for a partner-portal submission; null for the public landing-page form.
  contact_id uuid references public.industry_contacts (id) on delete set null,
  requester_type text not null check (requester_type in ('partner', 'public')),
  requester_name text not null,
  requester_email text not null,
  requester_phone text,
  request_kind text not null check (request_kind in ('quote_summary', 'listing_snapshot', 'both')),

  -- The address exactly as submitted, before any county match is attempted.
  address_line text not null,
  city text not null,
  state text not null default 'FL',
  zipcode text,

  -- Optional details the submitter may already know, used as a fallback when
  -- county-record enrichment can't find or complete a match.
  year_built int,
  sqft int,
  beds int,
  baths numeric,
  construction text,
  list_price numeric,

  -- Optional coverage ask; the pipeline's usual defaults apply when null.
  dwelling_a numeric,
  personal_property_pct int,

  status text not null default 'new' check (
    status in ('new', 'processing', 'completed', 'failed', 'needs_review')
  ),
  status_detail text,
  property_id uuid references public.properties (id) on delete set null,

  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create index quote_requests_status_idx on public.quote_requests (agency_id, status);
create index quote_requests_contact_id_idx on public.quote_requests (contact_id);

alter table public.quote_requests enable row level security;

-- Internal producers/admins: full visibility, same pattern as every other table.
create policy "quote_requests: agency scoped" on public.quote_requests
  for all using (agency_id = public.current_agency_id())
  with check (agency_id = public.current_agency_id());

-- A partner sees only requests tied to their own directory contact. Writes
-- (both public and partner submissions) always go through a service-role
-- server action that sets contact_id itself from the verified session rather
-- than trusting client input, so no partner INSERT policy is needed here.
create policy "quote_requests: partner reads own" on public.quote_requests
  for select using (contact_id = public.current_partner_contact_id());

-- ---------------------------------------------------------------------------
-- Narrow, additive read access so a partner can see the result of their own
-- request (the matched property and its generated proposal) without any
-- visibility into anyone else's data. Existing agency-scoped policies on
-- these tables are untouched — this only adds a second way a row can pass.
-- ---------------------------------------------------------------------------

create policy "properties: partner sees own requested property" on public.properties
  for select using (
    id in (
      select property_id from public.quote_requests
      where contact_id = public.current_partner_contact_id() and property_id is not null
    )
  );

create policy "proposals: partner sees own requested proposals" on public.proposals
  for select using (
    property_id in (
      select property_id from public.quote_requests
      where contact_id = public.current_partner_contact_id() and property_id is not null
    )
  );

-- Properties created directly from a quote request (as opposed to a listing feed).
alter table public.properties
  drop constraint properties_source_check,
  add constraint properties_source_check check (
    source in ('bridge', 'trestle', 'mlsgrid', 'county', 'onehome', 'quote_request')
  );
