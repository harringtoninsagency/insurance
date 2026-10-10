-- Append-only follow-up log for realtor/mortgage-broker contacts: what was
-- discussed and when to check back in. Mirrors contact_consent_events —
-- industry_contacts holds no follow-up state of its own; this table is the
-- history, and "next follow-up" is read off its most recent row. Users can
-- read and add entries but not edit or delete them.

create table public.contact_follow_ups (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  contact_id uuid not null references public.industry_contacts (id) on delete cascade,
  note text not null,
  next_follow_up_on date,
  recorded_by text,
  created_at timestamptz not null default now()
);

create index contact_follow_ups_contact_idx
  on public.contact_follow_ups (contact_id, created_at desc);

alter table public.contact_follow_ups enable row level security;

create policy "follow ups: agency read" on public.contact_follow_ups
  for select using (agency_id = public.current_agency_id());

create policy "follow ups: agency insert" on public.contact_follow_ups
  for insert with check (agency_id = public.current_agency_id());
