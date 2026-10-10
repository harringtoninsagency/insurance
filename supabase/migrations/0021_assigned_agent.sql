-- Which in-house team member a property is assigned to, shown and editable
-- on the Properties list. Nullable (unassigned by default); cleared rather
-- than blocked if that team member is ever removed.

alter table public.properties
  add column assigned_agent_id uuid references public.profiles (id) on delete set null;

create index properties_assigned_agent_id_idx on public.properties (assigned_agent_id);
