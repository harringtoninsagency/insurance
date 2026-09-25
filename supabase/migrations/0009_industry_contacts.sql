-- Referral-source directory: Florida realtors and mortgage brokers the agency
-- wants to build relationships with. Agency-scoped like every other table.
--
-- Beyond the five contact data points (name, company, cell, office phone,
-- email) each row records where it came from and what the person has agreed
-- to, so outreach can be limited to people we're allowed to contact:
--   * email_consent / sms_consent — cell numbers must never be texted or
--     autodialed without documented written consent (TCPA / Florida FTSA).
--   * do_not_contact — hard stop honored by every outreach path.

create table public.industry_contacts (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  contact_type text not null check (contact_type in ('realtor', 'mortgage_broker')),
  full_name text not null,
  company_name text,
  cell_phone text,
  office_phone text,
  email text,
  license_number text,
  license_state text not null default 'FL',
  city text,
  source text not null default 'manual'
    check (source in ('manual', 'csv_import', 'listing_agent', 'public_license', 'referral', 'event', 'web_form', 'other')),
  source_detail text,
  email_consent text not null default 'unknown' check (email_consent in ('unknown', 'opted_in', 'opted_out')),
  sms_consent text not null default 'none' check (sms_consent in ('none', 'written')),
  do_not_contact boolean not null default false,
  status text not null default 'prospect' check (status in ('prospect', 'contacted', 'engaged', 'active_partner')),
  notes text,
  last_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One row per person: the same email or the same license can't be added twice.
create unique index industry_contacts_email_uniq
  on public.industry_contacts (agency_id, lower(email)) where email is not null;
create unique index industry_contacts_license_uniq
  on public.industry_contacts (agency_id, contact_type, license_number) where license_number is not null;

create index industry_contacts_type_idx on public.industry_contacts (agency_id, contact_type);
create index industry_contacts_name_idx on public.industry_contacts (agency_id, lower(full_name));

alter table public.industry_contacts enable row level security;

create policy "industry_contacts: agency scoped" on public.industry_contacts
  for all using (agency_id = public.current_agency_id())
  with check (agency_id = public.current_agency_id());
