-- Re-quoting a property was supposed to "upsert onto its existing quote
-- rows" (see docs/process-quote-requests.md), but the ingest upsert keyed
-- on (property_id, external_rate_id) — and Fetch mints a brand-new rate id
-- on every quote run, even for the identical carrier/form/property. So a
-- re-quote never actually matched an old row; it just inserted a new one.
-- Properties quoted more than once ended up with several stale rows per
-- carrier+form, and the PDF generators' "top N cheapest" carrier-table
-- logic had no way to tell those apart from genuinely different carriers —
-- hence the same carrier appearing twice on a listing snapshot. See
-- lib/quotes/ingest.ts and lib/proposals/generate-listing-snapshot.ts.

-- Keep only the most recent row per (property_id, carrier, form_type);
-- id as a tiebreaker for the vanishingly unlikely case of equal timestamps.
delete from public.quotes q
using (
  select id,
    row_number() over (
      partition by property_id, carrier, form_type
      order by created_at desc, id desc
    ) as rn
  from public.quotes
  where form_type is not null
) ranked
where q.id = ranked.id
  and ranked.rn > 1;

-- Going forward, the ingest upsert targets this constraint instead of
-- (property_id, external_rate_id) — the latter remains in place too, as a
-- harmless guard against two different carrier+form rows somehow sharing a
-- rate id.
alter table public.quotes
  add constraint quotes_property_carrier_form_key unique (property_id, carrier, form_type);
