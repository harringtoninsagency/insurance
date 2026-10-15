-- Which in-house team member owns following up on a quote request, shown
-- and editable on the Quote requests list and summarized on the new Home
-- page. Separate from `requested_by` (who queued the request — origin, not
-- ownership) and modeled the same way as `properties.assigned_agent_id`
-- (see 0021_assigned_agent.sql): nullable, cleared rather than blocked if
-- that team member is ever removed.

alter table public.quote_requests
  add column assigned_agent_id uuid references public.profiles (id) on delete set null;

create index quote_requests_assigned_agent_id_idx on public.quote_requests (assigned_agent_id);
