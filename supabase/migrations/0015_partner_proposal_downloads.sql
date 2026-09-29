-- Partner portal, stage 1 follow-up: the `proposals` storage bucket's only
-- policy keys off current_agency_id() (0001_init_schema.sql), which is null
-- for a partner (they have no profiles row) — so without this, a partner
-- could see their own proposal row in the database but could never actually
-- generate a signed URL to download the PDF itself.
--
-- Proposal files are stored at "<agency_id>/<property_id>/<filename>", so the
-- property_id is the second path segment. This grants read-only access to
-- exactly the files under a property_id tied to one of the partner's own
-- quote_requests — the same scoping already used for the `properties` and
-- `proposals` table policies in 0014_partner_portal.sql.
create policy "proposals bucket: partner reads own" on storage.objects
  for select using (
    bucket_id = 'proposals'
    and (storage.foldername(name))[2] in (
      select property_id::text from public.quote_requests
      where contact_id = public.current_partner_contact_id() and property_id is not null
    )
  );

-- Also missed in 0014: internal producers/admins had NO policy on
-- partner_accounts at all (only the partner's own self-read policy), so the
-- contacts directory page couldn't show anyone's invite status. Matches the
-- "agency scoped: for all" convention every other internal table already uses.
create policy "partner_accounts: agency scoped" on public.partner_accounts
  for all using (agency_id = public.current_agency_id())
  with check (agency_id = public.current_agency_id());
