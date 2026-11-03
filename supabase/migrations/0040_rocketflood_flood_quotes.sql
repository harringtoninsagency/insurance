-- RocketFlood instant flood quotes as a second quote source alongside Fetch,
-- run inline in the SAME routine pass as the home quote (not a separate
-- schedule) — see docs/process-quote-requests.md's new flood sub-steps.
-- RocketFlood (quotemanager.rocketflood.com) has no API — quoting it means
-- the same agent session that's already handling this request also drives a
-- Claude in Chrome browser automation against the RocketFlood portal and
-- reads the result off the page, instead of (or alongside) calling Fetch's
-- MCP tools. One claim (the existing claimed_at) covers both jobs for a
-- request, since one run does both — no separate flood claim column needed.
--
-- requested_flood_quote: opt-in per request, same pattern as
-- requested_roof_scenario (0025) — set when the submitter (partner portal,
-- consumer re-shop page, or staff "Run quote now") asked for a flood quote
-- alongside the home quote.
-- flood_status / flood_status_detail: tracked separately from the home
-- quote's own status/status_detail, purely so a flood failure (RocketFlood
-- portal error, declined risk, scrape mismatch) never marks the whole
-- request failed or blocks the home quote's own proposal — the two outcomes
-- are independent even though they're produced in the same pass.
-- flood_processed_at: mirrors processed_at, set when the flood attempt
-- (success or failure) finishes, same moment finalize runs for the request.
alter table public.quote_requests
add column requested_flood_quote boolean not null default false,
add column flood_status text,
add column flood_status_detail text,
add column flood_processed_at timestamptz;

-- Same value set as the home quote_requests_status_check, minus 'new'.
-- 'processing' is decided by prepare.ts at submission time (same moment it
-- decides the home quote's own status) and means "eligible, will be
-- attempted in the same routine pass that handles this request's home
-- quote" — not a separate in-flight marker, since there's no separate flood
-- claim/run to be in-flight for. Kept independent of the home status check
-- so a change to one status machine can't accidentally loosen the other.
alter table public.quote_requests
add constraint quote_requests_flood_status_check check (
  flood_status is null or flood_status in ('processing', 'completed', 'failed', 'needs_review')
);

-- RocketFlood as a new quotes.adapter value alongside the existing Fetch
-- one. carrier and form_type are already free text with no check
-- constraint — this produces carrier = 'RocketFlood', form_type = 'flood'.
-- is_indicative should always be true for these: RocketFlood's instant quote
-- is a scraped estimate off their quoting UI, not a bound rate.
alter table public.quotes
drop constraint quotes_adapter_check,
add constraint quotes_adapter_check check (
  adapter in ('indicative', 'manual', 'selectsys', 'ivans', 'fetch_quoting', 'rocketflood')
);
