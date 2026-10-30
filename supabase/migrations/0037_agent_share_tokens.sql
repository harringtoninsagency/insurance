-- Revocable per-agent share links, from the "Quote app access and front
-- doors" plan's guardrail table: a partner share link currently baked the
-- agent's own permanent profiles.id straight into a public URL/QR
-- code/social graphic (app/(dash)/share/page.tsx) — not guessable, but with
-- no way to kill it without deactivating the agent's whole account. An
-- opaque token the team can revoke and reissue fixes that: killing a leaked
-- or publicly-reposted link has no effect on the agent's own login or
-- assigned work.

create table public.agent_share_tokens (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  agent_id uuid not null references public.profiles (id) on delete cascade,
  token text not null unique,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index agent_share_tokens_agent_idx on public.agent_share_tokens (agent_id, revoked_at);

-- At most one live token per agent at a time — reissuing revokes the old
-- one first (see lib/team/share-tokens.ts), never leaves two active.
create unique index agent_share_tokens_one_active_per_agent
  on public.agent_share_tokens (agent_id)
  where revoked_at is null;

alter table public.agent_share_tokens enable row level security;

-- Internal producers/admins only, same pattern as every other agency-scoped
-- table. Public resolution (a token arriving on /partner/signup or
-- /share/og) goes through a service-role call (lib/team/share-tokens.ts),
-- same as resolvePublicAgent already does, so no anon SELECT policy is
-- needed here.
create policy "agent_share_tokens: agency scoped" on public.agent_share_tokens
  for all using (agency_id = public.current_agency_id())
  with check (agency_id = public.current_agency_id());
