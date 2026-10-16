-- New referral-partner category: roofing companies, which run quotes under
-- special rules (see lib/adapters/fetch-quoting.ts and
-- lib/quote-requests/fetch-pipeline.ts) rather than being quoted like a
-- realtor/mortgage-broker referral.

alter table public.industry_contacts
  drop constraint industry_contacts_contact_type_check,
  add constraint industry_contacts_contact_type_check
    check (contact_type in ('realtor', 'mortgage_broker', 'roofing_company'));
