-- The partial unique index from 0002 isn't usable as a PostgREST upsert
-- ON CONFLICT target (PostgREST emits a plain column-list ON CONFLICT, which
-- can't match an index with a WHERE predicate). A plain unique constraint
-- works the same way here since Postgres already treats NULLs as distinct,
-- so multiple rows with external_rate_id = null are still allowed.

drop index if exists public.quotes_property_external_rate_idx;

alter table public.quotes
  add constraint quotes_property_external_rate_key unique (property_id, external_rate_id);
