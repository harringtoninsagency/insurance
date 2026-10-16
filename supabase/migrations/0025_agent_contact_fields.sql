-- Fields needed to show a real in-house agent's photo and direct contact
-- info in a dedicated section near the bottom of both generated proposal
-- PDFs (indication summary + listing snapshot), instead of the agency's one
-- shared phone/email line that used to sit above the logo.
--
-- phone_extension is the agent's own extension off the shared office line
-- (727-789-2200) — not a full replacement number. personal_email is the
-- agent's direct inbox for a buyer to reach them at; falls back to
-- profiles.email (their login) when not set.

alter table public.profiles
  add column photo_path text,
  add column personal_email text,
  add column phone_extension text;

insert into storage.buckets (id, name, public)
values ('agent-photos', 'agent-photos', false)
on conflict (id) do nothing;

-- Same "<agency_id>/<profile_id>/<filename>" scoping as the listing-photos
-- and proposals buckets.
create policy "agent-photos bucket: agency scoped" on storage.objects
  for all using (
    bucket_id = 'agent-photos'
    and (storage.foldername(name))[1] = public.current_agency_id()::text
  )
  with check (
    bucket_id = 'agent-photos'
    and (storage.foldername(name))[1] = public.current_agency_id()::text
  );
