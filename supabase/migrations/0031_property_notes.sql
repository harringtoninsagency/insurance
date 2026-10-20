-- Append-only notes log for properties, same pattern as
-- contact_follow_ups: a running history of what was said/done about a
-- property, not a single overwritable field. Users can read and add
-- entries but not edit or delete them.

create table public.property_notes (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  property_id uuid not null references public.properties (id) on delete cascade,
  note text not null,
  recorded_by text,
  created_at timestamptz not null default now()
);

create index property_notes_property_idx
  on public.property_notes (property_id, created_at desc);

alter table public.property_notes enable row level security;

create policy "property notes: agency read" on public.property_notes
  for select using (agency_id = public.current_agency_id());

create policy "property notes: agency insert" on public.property_notes
  for insert with check (agency_id = public.current_agency_id());
