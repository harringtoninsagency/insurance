-- Which in-house insurance agent is the referral relationship with this
-- realtor/broker tied to. Free text (not a checked enum) so a custom name
-- typed in the "Other" field on the Add Contact form is just as valid as one
-- of the preset dropdown names — the dropdown is a UI convenience, not a
-- closed set the database should enforce.

alter table public.industry_contacts
  add column referral_partner_agent text;
