-- "New Roof Scenario - Insurance Summary": a variant of the indication
-- summary generated for roofing_company referral partners, whose quote
-- requests already run under the roofingCompanyOverride rules (forced
-- current-year roof_year) in lib/adapters/fetch-quoting.ts.

alter table public.proposals
  drop constraint proposals_kind_check,
  add constraint proposals_kind_check check (kind in ('indication', 'firm', 'listing_snapshot', 'roof_scenario'));
