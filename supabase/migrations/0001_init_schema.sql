-- FetchRival Phase 1 schema.
-- Single-tenant today, but every business table carries agency_id so
-- productizing to multi-agency later is a config change, not a rewrite.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Agencies & profiles
-- ---------------------------------------------------------------------------

create table public.agencies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  license_number text,
  created_at timestamptz not null default now()
);

-- One row per auth.users, carrying the agency_id every RLS policy keys off.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  agency_id uuid not null references public.agencies (id) on delete cascade,
  email text not null,
  role text not null default 'producer' check (role in ('producer', 'admin')),
  created_at timestamptz not null default now()
);

-- Resolves the calling user's agency_id for use in RLS policies below.
create function public.current_agency_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select agency_id from public.profiles where id = auth.uid()
$$;

-- ---------------------------------------------------------------------------
-- Properties & enrichment
-- ---------------------------------------------------------------------------

create table public.properties (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  mls_id text,
  source text not null check (source in ('bridge', 'trestle', 'mlsgrid', 'county')),
  address text not null,
  parcel_id text,
  year_built int,
  construction text,
  roof_year int,
  sqft int,
  lat double precision,
  lng double precision,
  list_price numeric,
  listing_agent_name text,
  listing_agent_email text,
  listing_agent_phone text,
  status text not null default 'new' check (
    status in ('new', 'enriched', 'indication_sent', 'replied', 'quoted', 'closed', 'dead')
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agency_id, parcel_id)
);

create index properties_agency_id_idx on public.properties (agency_id);
create index properties_status_idx on public.properties (agency_id, status);

create table public.enrichments (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  property_id uuid not null references public.properties (id) on delete cascade,
  flood_zone text,
  wind_borne_debris_region boolean,
  dist_to_coast_miles numeric,
  county_appraiser_payload jsonb,
  terrain text,
  provider text,
  fetched_at timestamptz not null default now()
);

create index enrichments_property_id_idx on public.enrichments (property_id);

-- ---------------------------------------------------------------------------
-- Documents (4-point / wind mit / inspection / carrier quote uploads)
-- ---------------------------------------------------------------------------

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  property_id uuid not null references public.properties (id) on delete cascade,
  kind text not null check (kind in ('4point', 'windmit', 'inspection', 'carrier_quote')),
  storage_path text not null,
  extraction_json jsonb,
  extraction_confidence jsonb,
  created_at timestamptz not null default now()
);

create index documents_property_id_idx on public.documents (property_id);

-- ---------------------------------------------------------------------------
-- Risk profiles, carrier appetites, quotes
-- ---------------------------------------------------------------------------

create table public.risk_profiles (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  property_id uuid not null references public.properties (id) on delete cascade,
  underwriting_inputs jsonb not null default '{}'::jsonb,
  wind_mit_credit_vector jsonb,
  created_at timestamptz not null default now()
);

create index risk_profiles_property_id_idx on public.risk_profiles (property_id);

create table public.carrier_appetites (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  carrier text not null,
  rules jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (agency_id, carrier)
);

create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  property_id uuid not null references public.properties (id) on delete cascade,
  carrier text not null,
  adapter text not null check (adapter in ('indicative', 'manual', 'selectsys', 'ivans')),
  premium numeric,
  coverages jsonb,
  credits jsonb,
  is_indicative boolean not null default true,
  created_at timestamptz not null default now()
);

create index quotes_property_id_idx on public.quotes (property_id);

-- ---------------------------------------------------------------------------
-- Proposals & outreach
-- ---------------------------------------------------------------------------

create table public.proposals (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  property_id uuid not null references public.properties (id) on delete cascade,
  kind text not null check (kind in ('indication', 'firm')),
  pdf_path text,
  version int not null default 1,
  created_at timestamptz not null default now()
);

create index proposals_property_id_idx on public.proposals (property_id);

create table public.outreach (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  proposal_id uuid not null references public.proposals (id) on delete cascade,
  recipient text not null,
  status text not null default 'pending_review' check (
    status in ('pending_review', 'approved', 'sent', 'bounced')
  ),
  approved_by uuid references public.profiles (id),
  sent_at timestamptz,
  opens int not null default 0,
  replies int not null default 0,
  created_at timestamptz not null default now()
);

create index outreach_status_idx on public.outreach (agency_id, status);

create table public.suppressions (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  email_or_domain text not null,
  reason text,
  created_at timestamptz not null default now(),
  unique (agency_id, email_or_domain)
);

-- ---------------------------------------------------------------------------
-- Row level security — every table scoped to the caller's agency_id
-- ---------------------------------------------------------------------------

alter table public.agencies enable row level security;
alter table public.profiles enable row level security;
alter table public.properties enable row level security;
alter table public.enrichments enable row level security;
alter table public.documents enable row level security;
alter table public.risk_profiles enable row level security;
alter table public.carrier_appetites enable row level security;
alter table public.quotes enable row level security;
alter table public.proposals enable row level security;
alter table public.outreach enable row level security;
alter table public.suppressions enable row level security;

create policy "profile: read own" on public.profiles
  for select using (id = auth.uid());

create policy "agency: read own" on public.agencies
  for select using (id = public.current_agency_id());

create policy "properties: agency scoped" on public.properties
  for all using (agency_id = public.current_agency_id())
  with check (agency_id = public.current_agency_id());

create policy "enrichments: agency scoped" on public.enrichments
  for all using (agency_id = public.current_agency_id())
  with check (agency_id = public.current_agency_id());

create policy "documents: agency scoped" on public.documents
  for all using (agency_id = public.current_agency_id())
  with check (agency_id = public.current_agency_id());

create policy "risk_profiles: agency scoped" on public.risk_profiles
  for all using (agency_id = public.current_agency_id())
  with check (agency_id = public.current_agency_id());

create policy "carrier_appetites: agency scoped" on public.carrier_appetites
  for all using (agency_id = public.current_agency_id())
  with check (agency_id = public.current_agency_id());

create policy "quotes: agency scoped" on public.quotes
  for all using (agency_id = public.current_agency_id())
  with check (agency_id = public.current_agency_id());

create policy "proposals: agency scoped" on public.proposals
  for all using (agency_id = public.current_agency_id())
  with check (agency_id = public.current_agency_id());

create policy "outreach: agency scoped" on public.outreach
  for all using (agency_id = public.current_agency_id())
  with check (agency_id = public.current_agency_id());

create policy "suppressions: agency scoped" on public.suppressions
  for all using (agency_id = public.current_agency_id())
  with check (agency_id = public.current_agency_id());

-- ---------------------------------------------------------------------------
-- Storage buckets
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('proposals', 'proposals', false)
on conflict (id) do nothing;

-- Storage objects are keyed "<agency_id>/<property_id>/<filename>" so the
-- same agency-scoped policy pattern applies to file access.
create policy "documents bucket: agency scoped" on storage.objects
  for all using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = public.current_agency_id()::text
  )
  with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = public.current_agency_id()::text
  );

create policy "proposals bucket: agency scoped" on storage.objects
  for all using (
    bucket_id = 'proposals'
    and (storage.foldername(name))[1] = public.current_agency_id()::text
  )
  with check (
    bucket_id = 'proposals'
    and (storage.foldername(name))[1] = public.current_agency_id()::text
  );
