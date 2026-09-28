-- Tracking for actually sending approved outreach through the email provider.
--   provider_message_id — the provider's id for the sent message; bounce and
--     spam-complaint webhooks use it to find the outreach item.
--   send_error — why a send failed, was blocked at send time, or bounced.
-- sent_at (already on the table) doubles as the "claimed for sending" marker:
-- it is set atomically before the provider is called, so two clicks or two
-- workers can never send the same item twice.

alter table public.outreach
  add column provider_message_id text,
  add column send_error text;

create unique index outreach_provider_message_id_uniq
  on public.outreach (provider_message_id) where provider_message_id is not null;
