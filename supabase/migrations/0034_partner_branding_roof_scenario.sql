-- Referral-partner co-branding (own photo on generated PDFs + a company
-- logo shown in their own portal) and an explicit "New Roof Scenario" ask on
-- the partner-portal quote-request form, alongside the existing automatic
-- detection for roofing_company partners (lib/quote-requests/fetch-pipeline.ts).

alter table public.industry_contacts
  add column photo_path text,
  add column logo_path text;

alter table public.quote_requests
  add column requested_roof_scenario boolean not null default false;

insert into storage.buckets (id, name, public)
values ('partner-photos', 'partner-photos', false), ('partner-logos', 'partner-logos', false)
on conflict (id) do nothing;

-- No storage.objects policy, by the same reasoning as industry_contacts
-- below: every partner-portal write already goes through a service-role
-- server action (see app/partner/(portal)/actions.ts), and every read of
-- these files is a service-role-generated signed URL (page.tsx), never the
-- partner's own RLS-scoped session — so there's no client-side access this
-- needs to grant.

-- industry_contacts had zero partner-facing RLS (see 0014_partner_portal.sql's
-- own top comment) — even a partner's own row was unreadable through their
-- session, which silently broke app/partner/(portal)/layout.tsx's
-- "Partner" fallback name. Additive, same pattern as that migration's
-- quote_requests/properties/proposals partner policies: a partner can read
-- only their own directory row, nothing else about this table changes.
create policy "industry_contacts: partner reads own" on public.industry_contacts
  for select using (id = public.current_partner_contact_id());
