-- Tags which marketed funnel a consumer quote request came from, so a
-- dedicated landing page (e.g. the InstaHomeQuote domain) can be tracked and
-- reported on separately from the existing /quote re-shop page, even though
-- both submit through the exact same pipeline. Null means "not a tracked
-- funnel" — the existing /quote page and every other requester_type keep
-- this unset.

alter table public.quote_requests add column lead_source text;

alter table public.quote_requests
  add constraint quote_requests_lead_source_check
  check (lead_source is null or lead_source in ('instahomequote'));
