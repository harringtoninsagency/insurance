"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { reissueAgentShareToken } from "@/lib/team/share-tokens";

export type ReissueLinkResult = { ok: true } | { ok: false; error: string };

/**
 * Kills an agent's current share link and mints a replacement — the
 * "revocable link" guardrail from the "Quote app access and front doors"
 * plan. Use when a link was publicly reposted somewhere unintended, or the
 * agent is leaving and their old link shouldn't keep onboarding partners.
 */
export async function reissueAgentLinkAction(agentId: string): Promise<ReissueLinkResult> {
  try {
    const supabase = await createServerSupabase();
    const { data: agent, error: readError } = await supabase.from("profiles").select("agency_id").eq("id", agentId).single();
    if (readError || !agent) return { ok: false, error: "Agent not found." };

    await reissueAgentShareToken(supabase, agent.agency_id, agentId);
    revalidatePath("/share");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to reissue this link." };
  }
}
