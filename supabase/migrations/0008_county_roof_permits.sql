-- Most recent roof permit per parcel, synced from PCPAO's official
-- RP_PERMITS bulk export (all issuing agencies: the county and every city)
-- via scripts/sync-pinellas-permits.ts. Used to set properties.roof_year from
-- real permit history instead of a flat default. Shared public-record
-- reference data like county_parcels: not agency-scoped, RLS-enabled with no
-- policies so it's reachable only via the service-role client.

create table public.county_roof_permits (
  strap text primary key,
  parcel_number text,
  permit_number text,
  agency_name text,
  issue_dt date not null,
  roof_year int not null,
  est_val numeric,
  roof_permit_count int not null default 1,
  synced_at timestamptz not null default now()
);

create index county_roof_permits_parcel_number_idx
  on public.county_roof_permits (parcel_number);

alter table public.county_roof_permits enable row level security;
