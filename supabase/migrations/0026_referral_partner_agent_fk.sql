-- referral_partner_agent was a free-text name snapshot (so a custom "Other"
-- name typed on the Add Contact form didn't have to match any real team
-- member). Generating a proposal's agent-contact section now needs this to
-- resolve to a real profiles row (for its photo/personal email/extension),
-- so it becomes a real foreign key. Existing values are backfilled by an
-- exact full_name match within the same agency; anything that doesn't match
-- (a departed or custom-typed name) is simply dropped — free text is no
-- longer accepted going forward, same as assigned_agent_id elsewhere.

alter table public.industry_contacts
  add column referral_partner_agent_id uuid references public.profiles (id) on delete set null;

update public.industry_contacts ic
set referral_partner_agent_id = p.id
from public.profiles p
where ic.referral_partner_agent is not null
  and p.agency_id = ic.agency_id
  and lower(p.full_name) = lower(ic.referral_partner_agent);

alter table public.industry_contacts drop column referral_partner_agent;

create index industry_contacts_referral_partner_agent_id_idx
  on public.industry_contacts (referral_partner_agent_id);
