"use server";

import { revalidatePath } from "next/cache";
import { applyCountyEnrichment } from "@/lib/enrichment/apply-county-enrichment";
import { generateIndicationProposal } from "@/lib/proposals/generate-indication";
import { queueOutreach } from "@/lib/outreach/queue";
import { createServiceSupabase } from "@/lib/supabase/server";

export async function pullCountyDataAction(propertyId: string) {
  const result = await applyCountyEnrichment(propertyId);
  revalidatePath(`/properties/${propertyId}`);
  return result;
}

export async function generateProposalAction(propertyId: string) {
  const result = await generateIndicationProposal(propertyId);
  revalidatePath(`/properties/${propertyId}`);
  return result;
}

export async function queueOutreachAction(propertyId: string, proposalId: string, recipient: string) {
  const supabase = createServiceSupabase();
  const { data: proposal, error } = await supabase
    .from("proposals")
    .select("agency_id")
    .eq("id", proposalId)
    .single();
  if (error || !proposal) {
    throw new Error(`Proposal ${proposalId} not found: ${error?.message ?? "no row"}`);
  }

  const result = await queueOutreach(proposal.agency_id, proposalId, recipient);
  revalidatePath(`/properties/${propertyId}`);
  return result;
}
