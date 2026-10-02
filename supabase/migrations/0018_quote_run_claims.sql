-- Run quote now fires the quote routine on demand, so two routine runs can overlap
-- (a click during the hourly run, or two clicks close together).
--   claimed_at       a run stamps this on a request before it starts quoting it, so a
--                    second run skips it. A claim older than 45 minutes is treated as
--                    abandoned (crashed run) and can be taken again.
--   routine_fired_at when the app last fired the routine for this request; used to
--                    throttle repeat fires.
alter table public.quote_requests
  add column claimed_at timestamptz,
  add column routine_fired_at timestamptz;
