-- Link each outreach item to the realtor / mortgage broker it's going to, when
-- the recipient's email is in the directory. Lets the review screen show who
-- the person is and what they've agreed to, and keeps a history per contact.
-- set null (not cascade): deleting a directory entry must not erase the record
-- of what was queued or sent to them.

alter table public.outreach
  add column contact_id uuid references public.industry_contacts (id) on delete set null;

create index outreach_contact_id_idx on public.outreach (contact_id);
