-- Proof of consent for contacts who opt in through the public /partners page.
-- Texting a cell number requires documented prior express written consent, so
-- each opt-in keeps when it happened, the exact wording the person agreed to,
-- and the IP it came from.

alter table public.industry_contacts
  add column email_consent_at timestamptz,
  add column sms_consent_at timestamptz,
  add column consent_text text,
  add column consent_ip text;
