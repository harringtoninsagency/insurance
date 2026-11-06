-- Two-touch follow-up email sequence to the referral partner after their
-- quote request completes and the results email goes out (see
-- lib/quote-requests/follow-ups.ts). One row per touch, scheduled the
-- moment finalizeQuoteRequest marks a partner request completed:
--   touch 1 — 2 business days later ("did the numbers land okay?")
--   touch 2 — 7 business days later ("closing the loop")
-- A daily Vercel cron (app/api/cron/quote-follow-ups) sends whatever is due.
--
-- Partner requests only (requester_type = 'partner'): public/internal
-- requests go through the producer-reviewed /review queue and consumer
-- requests get a licensed agent's personal follow-up, so neither gets an
-- automated sequence.
--
-- Lifecycle per row:
--   scheduled_for set, sent_at/stopped_at null  -> waiting
--   sent_at set                                 -> sent (provider_message_id kept for bounce/complaint webhooks)
--   stopped_at set                              -> will never send (stopped_reason says why: a producer clicked
--                                                  "Stop follow-ups", the partner put in a newer request for the
--                                                  same property, the address was suppressed, ...)
--   send_error set, sent_at null                -> last attempt failed; retried on the next run
-- sent_at is claimed atomically before the provider is called (same pattern
-- as outreach.sent_at) so two overlapping cron runs can never send twice.

create table public.quote_request_follow_ups (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  quote_request_id uuid not null references public.quote_requests (id) on delete cascade,
  touch smallint not null check (touch in (1, 2)),
  scheduled_for date not null,
  sent_at timestamptz,
  provider_message_id text,
  send_error text,
  stopped_at timestamptz,
  stopped_reason text,
  created_at timestamptz not null default now(),
  unique (quote_request_id, touch)
);

create index quote_request_follow_ups_due_idx
  on public.quote_request_follow_ups (scheduled_for)
  where sent_at is null and stopped_at is null;

create unique index quote_request_follow_ups_provider_message_id_uniq
  on public.quote_request_follow_ups (provider_message_id) where provider_message_id is not null;

alter table public.quote_request_follow_ups enable row level security;

-- Producers/admins see and can stop their agency's follow-ups from the
-- dashboard. Rows are only ever created and sent by service-role code
-- (the finalize pipeline and the cron), so no insert policy.
create policy "quote_request_follow_ups: agency read" on public.quote_request_follow_ups
  for select using (agency_id = public.current_agency_id());

create policy "quote_request_follow_ups: agency update" on public.quote_request_follow_ups
  for update using (agency_id = public.current_agency_id())
  with check (agency_id = public.current_agency_id());
