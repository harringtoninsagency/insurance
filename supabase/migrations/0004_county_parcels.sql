-- Local reference cache of Pinellas County Property Appraiser parcel data
-- (single-family only), synced from PCPAO's official Raw Database Files
-- bulk export via scripts/sync-pinellas-parcels.ts. Not agency-scoped —
-- this is shared public-record reference data, not tenant data — and is
-- RLS-enabled with no policies so it's reachable only via the service-role
-- client, never the anon/public REST API.

create table public.county_parcels (
  strap text primary key,
  county text not null default 'Pinellas',
  parcel_number text,
  site_address text,
  city text,
  zipcode text,
  str_num text,
  str_name text,
  str_sfx text,
  year_built int,
  heated_area_sqft int,
  gross_area_sqft int,
  exterior_walls text,
  roof_cover text,
  roof_frame text,
  impr_dscr text,
  synced_at timestamptz not null default now()
);

create index county_parcels_match_idx
  on public.county_parcels (str_num, str_name, zipcode);

alter table public.county_parcels enable row level security;
