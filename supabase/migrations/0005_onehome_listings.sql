-- Phase 3 (scoped): OneHome saved-search email ingest.

alter table public.properties
  drop constraint properties_source_check,
  add constraint properties_source_check check (
    source in ('bridge', 'trestle', 'mlsgrid', 'county', 'onehome')
  );

alter table public.properties
  add column beds int,
  add column baths numeric;

alter table public.properties
  add constraint properties_agency_mls_id_key unique (agency_id, mls_id);
