-- Flood zone + distance-to-coast enrichment.
--   flood_zone / dist_to_coast_miles already exist on `enrichments` (migration
--   0001) but were never populated by any code path — this is what fills them.
--   flood_zone comes from a live point lookup against FEMA's own NFHL ArcGIS
--   REST service (lib/enrichment/flood-zone.ts) — no data to sync for that
--   one, it's queried per property.
--   dist_to_coast_miles is computed locally against a one-time bulk load of
--   NOAA/USGS's medium-resolution US shoreline, filtered down to Florida
--   (scripts/sync-florida-coastline.ts — the source dataset is continental-US
--   wide and this app only ever needs Florida distances), the same
--   bulk-download-once approach already used for county parcel data, rather
--   than depending on a live distance API.
-- Both need a property's coordinates first — lat/lon live on county_parcels
-- (one per STRAP, shared by every property matched to that parcel), populated
-- by scripts/sync-pinellas-parcel-coordinates.ts from PCPAO's own Parcel Label
-- Point shapefile (the official per-parcel GIS centroid, not a geocoder).

create extension if not exists postgis;

alter table public.county_parcels
  add column lat double precision,
  add column lon double precision;

-- Single row: the coastline is one MultiLineString covering Florida (plus
-- padding into neighboring states/the Gulf/Atlantic — see
-- scripts/sync-florida-coastline.ts's bounding box). The source shapefile is
-- a giant MultiPolygon; ST_Boundary of that, taken once at load time, is the
-- coastline curve itself rather than a filled land area, so ST_Distance to
-- it is meaningful for a point that's inland, not just for one offshore.
create table public.florida_coastline (
  id int primary key default 1,
  geom geometry(MultiLineString, 4326) not null,
  source text not null default 'USGS allus80k (NOAA medium-resolution US shoreline), filtered to Florida',
  synced_at timestamptz not null default now(),
  constraint florida_coastline_singleton check (id = 1)
);

alter table public.florida_coastline enable row level security;

create or replace function public.coastline_distance_miles(p_lon double precision, p_lat double precision)
returns double precision
language sql
stable
as $$
  select ST_Distance(
    ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)::geography,
    geom::geography
  ) / 1609.344
  from public.florida_coastline
  where id = 1;
$$;

-- scripts/sync-florida-coastline.ts sends the shoreline as one WKT string
-- (PostgREST has no GeoJSON-to-geometry parsing of its own) and this does
-- the ST_GeomFromText conversion server-side, replacing the singleton row.
create or replace function public.load_florida_coastline(p_wkt text, p_source text)
returns void
language sql
as $$
  insert into public.florida_coastline (id, geom, source, synced_at)
  values (1, ST_SetSRID(ST_GeomFromText(p_wkt), 4326), p_source, now())
  on conflict (id) do update set geom = excluded.geom, source = excluded.source, synced_at = excluded.synced_at;
$$;
