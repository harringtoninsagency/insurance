"use server";

import { revalidatePath } from "next/cache";
import { applyCountyEnrichment } from "@/lib/enrichment/apply-county-enrichment";
import { generateIndicationProposal } from "@/lib/proposals/generate-indication";
import { generateListingSnapshotProposal } from "@/lib/proposals/generate-listing-snapshot";
import { uploadListingPhoto } from "@/lib/proposals/listing-photo";
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

export async function updateListingAgentAction(propertyId: string, formData: FormData) {
  const name = String(formData.get("listing_agent_name") ?? "").trim();
  const email = String(formData.get("listing_agent_email") ?? "").trim();
  const phone = String(formData.get("listing_agent_phone") ?? "").trim();

  const supabase = createServiceSupabase();
  const { error } = await supabase
    .from("properties")
    .update({
      listing_agent_name: name || null,
      listing_agent_email: email || null,
      listing_agent_phone: phone || null,
    })
    .eq("id", propertyId);
  if (error) throw new Error(`Failed to update listing agent: ${error.message}`);

  revalidatePath(`/properties/${propertyId}`);
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
