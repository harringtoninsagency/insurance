-- Append-only history of every consent change for a directory contact: who
-- agreed to or opted out of what, when, how it was obtained, and who recorded
-- it. industry_contacts holds only the *current* state; this table is the
-- evidence behind it (e.g. "signed sign-in sheet, Realtor Expo 9/20").
--
-- Deliberately keeps a snapshot of the contact's name/email/cell and does not
-- cascade on delete: an opt-out record must survive even if the contact row is
-- removed. Users can read and add events but not edit or delete them.

create table public.contact_consent_events (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  contact_id uuid references public.industry_contacts (id) on delete set null,
  contact_name text not null,
  contact_email text,
  contact_cell text,
  event_type text not null check (
    event_type in ('email_opt_in', 'sms_opt_in', 'email_opt_out', 'sms_opt_out', 'do_not_contact', 'do_not_contact_cleared')
  ),
  method text not null check (method in ('web_form', 'paper_form', 'written_reply', 'verbal', 'directory')),
  note text,
  consent_text text,
  ip text,
  occurred_at timestamptz not null default now(),
  recorded_by text,
  created_at timestamptz not null default now()
);

create index contact_consent_events_contact_idx
  on public.contact_consent_events (contact_id, occurred_at desc);

alter table public.contact_consent_events enable row level security;

create policy "consent events: agency read" on public.contact_consent_events
  for select using (agency_id = public.current_agency_id());

create policy "consent events: agency insert" on public.contact_consent_events
  for insert with check (agency_id = public.current_agency_id());
