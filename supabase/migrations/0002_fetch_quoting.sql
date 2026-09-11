-- Phase 2: structured address fields (Fetch's quote API requires them split,
-- not a single combined string) and quote provenance columns for
-- agent-mediated Fetch quoting.

alter table public.properties
  add column house_number text,
  add column street text,
  add column city text,
  add column county text,
  add column zipcode text,
  add column state text not null default 'FL';

alter table public.quotes
  drop constraint quotes_adapter_check,
  add constraint quotes_adapter_check check (
    adapter in ('indicative', 'manual', 'selectsys', 'ivans', 'fetch_quoting')
  );

alter table public.quotes
  add column external_quote_request_id text,
  add column external_rate_id text,
  add column form_type text,
  add column raw_response jsonb;

create unique index quotes_property_external_rate_idx
  on public.quotes (property_id, external_rate_id)
  where external_rate_id is not null;
-- Note: superseded by 0003_fix_quotes_rate_unique.sql — this partial index
-- can't serve as a PostgREST upsert ON CONFLICT target.
