-- Per-partner rate limit, from the "Quote app access and front doors" plan's
-- guardrail table: every address lookup costs Fetch calls and carrier
-- rating hits (possibly per-quote fees), so an unlimited partner link is a
-- real cost exposure, not just a spam risk. Defaults to 10/day; a producer
-- can bump it per contact from the contact detail page for a legitimately
-- high-volume partner.

alter table public.industry_contacts
  add column daily_request_limit int not null default 10;

alter table public.industry_contacts
  add constraint industry_contacts_daily_request_limit_check check (daily_request_limit > 0);
