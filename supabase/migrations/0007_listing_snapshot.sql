-- New Listing Insurance Snapshot: a buyer-facing proposal with a listing
-- photo, generated from the same quote data generate-indication.ts uses.

alter table public.properties add column photo_path text;

alter table public.proposals
  drop constraint proposals_kind_check,
  add constraint proposals_kind_check check (kind in ('indication', 'firm', 'listing_snapshot'));

insert into storage.buckets (id, name, public)
values ('listing-photos', 'listing-photos', false)
on conflict (id) do nothing;

-- Same "<agency_id>/<property_id>/<filename>" scoping as the proposals bucket.
create policy "listing-photos bucket: agency scoped" on storage.objects
  for all using (
    bucket_id = 'listing-photos'
    and (storage.foldername(name))[1] = public.current_agency_id()::text
  )
  with check (
    bucket_id = 'listing-photos'
    and (storage.foldername(name))[1] = public.current_agency_id()::text
  );
