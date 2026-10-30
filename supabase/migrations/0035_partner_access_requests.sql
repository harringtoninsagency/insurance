-- Gated partner access requests — replaces open self-signup
-- (lib/partners/self-signup.ts, removed) with a request-and-review model.
-- Per the "Quote app access and front doors" plan: objective licensure
-- criteria applied uniformly, nobody self-activates. A public form collects
-- this; a producer verifies the license and approves or denies; approval
-- upserts the directory contact and runs the existing admin-invite flow
-- (lib/partners/invite.ts) unchanged.

create table public.partner_access_requests (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  contact_type text not null check (contact_type in ('realtor', 'mortgage_broker', 'roofing_company')),
  full_name text not null,
  company_name text,
  email text not null,
  cell_phone text,
  license_number text not null,
  buyers_per_month text,
  referral_partner_agent_id uuid references public.profiles (id),
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
  status_detail text,
  -- Set on approval: the directory contact the request turned into.
  contact_id uuid references public.industry_contacts (id),
  reviewed_by uuid references public.profiles (id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create index partner_access_requests_status_idx
  on public.partner_access_requests (agency_id, status, created_at desc);

alter table public.partner_access_requests enable row level security;

-- Internal producers/admins only, same pattern as every other agency-scoped
-- table. The public form inserts through a service-role server action
-- (lib/partners/request-access.ts), same as quote_requests, so no anon
-- INSERT policy is needed here.
create policy "partner_access_requests: agency scoped" on public.partner_access_requests
  for all using (agency_id = public.current_agency_id())
  with check (agency_id = public.current_agency_id());
