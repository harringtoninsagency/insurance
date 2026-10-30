-- Adds "consumer" as its own requester_type — the homeowner re-shop front
-- door from the "Quote app access and front doors" plan (Funnel 3): a
-- public, single-ask page (app/quote) distinct from both the partner portal
-- and the existing direct-link form (app/request-quote). Kept separate from
-- the existing "public" value so its completion email (only the insurance
-- summary, auto-sent straight to the homeowner) never changes behavior for
-- any other public submission, which still goes through the
-- producer-reviewed outreach queue on /review.

alter table public.quote_requests
  drop constraint quote_requests_requester_type_check,
  add constraint quote_requests_requester_type_check check (
    requester_type in ('partner', 'public', 'internal', 'consumer')
  );
