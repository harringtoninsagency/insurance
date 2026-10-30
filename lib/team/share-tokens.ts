import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";

type Service = SupabaseClient<Database>;

/** Opaque, unguessable, and unrelated to the agent's own id — 18 random bytes as url-safe base64 (~144 bits). */
function generateToken(): string {
  return randomBytes(18).toString("base64url");
}

/**
 * The agent's current live share token — minted the first time one's asked
 * for (e.g. /share's first load for a newly added team member), reused on
 * every later load. This is what app/(dash)/share/page.tsx and
 * /share/og bake into the agent's public sign-up link, QR code, and
 * share graphic, instead of their permanent profiles.id.
 */
export async function getOrCreateAgentShareToken(service: Service, agencyId: string, agentId: string): Promise<string> {
  const { data: existing } = await service.from("agent_share_tokens").select("token").eq("agent_id", agentId).is("revoked_at", null).maybeSingle();
  if (existing) return existing.token;

  const token = generateToken();
  const { error } = await service.from("agent_share_tokens").insert({ agency_id: agencyId, agent_id: agentId, token });
  if (error) throw new Error(`Couldn't create a share link: ${error.message}`);
  return token;
}

/**
 * Revokes an agent's current share link (if any) and mints a replacement —
 * the "kill and reissue" guardrail from the "Quote app access and front
 * doors" plan: a leaked or publicly-reposted link stops working the moment
 * this runs, with no effect on the agent's own login or assigned work.
 */
export async function reissueAgentShareToken(service: Service, agencyId: string, agentId: string): Promise<string> {
  await service.from("agent_share_tokens").update({ revoked_at: new Date().toISOString() }).eq("agent_id", agentId).is("revoked_at", null);
  const token = generateToken();
  const { error } = await service.from("agent_share_tokens").insert({ agency_id: agencyId, agent_id: agentId, token });
  if (error) throw new Error(`Couldn't reissue the share link: ${error.message}`);
  return token;
}

/**
 * Resolves a public share-link token to the live agent it names — null if
 * it's unknown, revoked, or the agent is no longer active. Replaces
 * resolvePublicAgent for anything built from a public URL/QR/share graphic
 * (lib/team/team.ts's resolvePublicAgent stays for an already-authenticated
 * partner picking their own agent from a dropdown, which never carries a
 * share token).
 */
export async function resolveAgentShareToken(service: Service, agencyId: string, token: string | null | undefined): Promise<{ id: string; fullName: string | null } | null> {
  const trimmed = token?.trim();
  if (!trimmed) return null;
  const { data: row } = await service.from("agent_share_tokens").select("agent_id").eq("agency_id", agencyId).eq("token", trimmed).is("revoked_at", null).maybeSingle();
  if (!row) return null;
  const { data: agent } = await service.from("profiles").select("id, full_name").eq("agency_id", agencyId).eq("id", row.agent_id).eq("active", true).maybeSingle();
  return agent ? { id: agent.id, fullName: agent.full_name } : null;
}
