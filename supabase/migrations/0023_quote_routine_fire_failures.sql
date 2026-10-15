-- Tracks each time fireQuoteRoutine failed to start the on-demand quote run
-- (the request still gets processed by the hourly fallback — this is purely
-- so a string of failures, e.g. a stale QUOTE_ROUTINE_ID/QUOTE_ROUTINE_TOKEN,
-- can be detected and alerted on instead of silently degrading every
-- submission from ~2-minute turnaround to up to ~59 minutes unnoticed.
alter table public.quote_requests
  add column routine_fire_failed_at timestamptz;
