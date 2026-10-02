"use server";

import { revalidatePath } from "next/cache";
import { applyCountyEnrichment } from "@/lib/enrichment/apply-county-enrichment";
import { generateIndicationProposal } from "@/lib/proposals/generate-indication";
import { generateListingSnapshotProposal } from "@/lib/proposals/generate-listing-snapshot";
import { uploadListingPhoto } from "@/lib/proposals/listing-photo";
import { queueOutreach } from "@/lib/outreach/queue";
import { sessionContext } from "@/lib/contacts/session";
import { saveListingAgent, type ListingAgentResult } from "@/lib/properties/listing-agent";
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

export async function generateListingSnapshotAction(propertyId: string) {
  const result = await generateListingSnapshotProposal(propertyId);
  revalidatePath(`/properties/${propertyId}`);
  return result;
}

export async function uploadListingPhotoAction(propertyId: string, formData: FormData) {
  const file = formData.get("photo");
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("Choose a photo file first");
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const result = await uploadListingPhoto(propertyId, bytes, file.type);
  revalidatePath(`/properties/${propertyId}`);
  return result;
}

export async function updateListingAgentAction(propertyId: string, formData: FormData): Promise<ListingAgentResult> {
  try {
    // Runs as the signed-in team member (RLS-scoped), not the service role.
    const { supabase } = await sessionContext();
    const result = await saveListingAgent(supabase, propertyId, {
      name: String(formData.get("listing_agent_name") ?? ""),
      email: String(formData.get("listing_agent_email") ?? ""),
      phone: String(formData.get("listing_agent_phone") ?? ""),
    });
    revalidatePath(`/properties/${propertyId}`);
    revalidatePath("/properties");
    revalidatePath("/contacts");
    return result;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to save listing agent" };
  }
}

export async function updateDateQuotedAction(propertyId: string, formData: FormData): Promise<{ ok: true } | { ok: false; error: string }> {
  const raw = String(formData.get("date_quoted") ?? "").trim();
  if (raw && !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return { ok: false, error: "Enter a valid date." };
  try {
    const { supabase } = await sessionContext();
    const { error } = await supabase.from("properties").update({ date_quoted: raw || null }).eq("id", propertyId);
    if (error) return { ok: false, error: error.message };
    revalidatePath(`/properties/${propertyId}`);
    revalidatePath("/properties");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to save the date." };
  }
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
