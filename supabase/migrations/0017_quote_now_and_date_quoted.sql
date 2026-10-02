-- 1) Staff can queue a carrier quote from the dashboard ("Run quote now").
--    Same quote_requests queue the public form and partner portal feed, so the
--    scheduled routine picks them up unchanged — they just come from a signed-in
--    team member rather than an outside requester.
alter table public.quote_requests
  drop constraint quote_requests_requester_type_check,
  add constraint quote_requests_requester_type_check
    check (requester_type in ('partner', 'public', 'internal'));

alter table public.quote_requests
  add column requested_by uuid references public.profiles (id) on delete set null;

-- 2) "Date quoted" on each property: defaults to the date a quote was submitted
--    (queued), editable by staff. Backfilled from existing quotes.
alter table public.properties add column date_quoted date;

update public.properties p
set date_quoted = (
  select (max(q.created_at) at time zone 'America/New_York')::date
  from public.quotes q
  where q.property_id = p.id
)
where exists (select 1 from public.quotes q where q.property_id = p.id);
