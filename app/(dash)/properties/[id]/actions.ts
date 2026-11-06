"use server";

import { revalidatePath } from "next/cache";
import { applyCountyEnrichment } from "@/lib/enrichment/apply-county-enrichment";
import { describeCountyParcelMiss } from "@/lib/enrichment/county-parcels";
import { generateIndicationProposal } from "@/lib/proposals/generate-indication";
import { generateListingSnapshotProposal } from "@/lib/proposals/generate-listing-snapshot";
import { regenerateExistingProposals, resolvePropertyProposalContext } from "@/lib/proposals/regenerate";
import { uploadListingPhoto } from "@/lib/proposals/listing-photo";
import { queueOutreach } from "@/lib/outreach/queue";
import { sessionContext } from "@/lib/contacts/session";
import { saveListingAgent, type ListingAgentResult } from "@/lib/properties/listing-agent";
import { createServiceSupabase } from "@/lib/supabase/server";

export async function pullCountyDataAction(propertyId: string) {
  const result = await applyCountyEnrichment(propertyId);
  revalidatePath(`/properties/${propertyId}`);
  return { matched: result.matched, message: result.matched ? null : describeCountyParcelMiss(result.missReason) };
}

export async function generateProposalAction(propertyId: string) {
  const { quoteRequestId, referralPartner, roofScenario } = await resolvePropertyProposalContext(propertyId);
  const result = await generateIndicationProposal(propertyId, referralPartner, quoteRequestId, roofScenario);
  revalidatePath(`/properties/${propertyId}`);
  return result;
}

export async function generateListingSnapshotAction(propertyId: string) {
  const { quoteRequestId, referralPartner } = await resolvePropertyProposalContext(propertyId);
  const result = await generateListingSnapshotProposal(propertyId, referralPartner, quoteRequestId);
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

export async function updateManualCarrierAction(propertyId: string, formData: FormData): Promise<{ ok: true } | { ok: false; error: string }> {
  const name = String(formData.get("manual_carrier_name") ?? "").trim();
  const premiumRaw = String(formData.get("manual_carrier_premium") ?? "").trim();
  if (premiumRaw && !/^\d+(\.\d+)?$/.test(premiumRaw)) return { ok: false, error: "Enter a valid premium amount." };
  try {
    const { supabase } = await sessionContext();
    const { error } = await supabase
      .from("properties")
      .update({ manual_carrier_name: name || null, manual_carrier_premium: premiumRaw ? Number(premiumRaw) : null })
      .eq("id", propertyId);
    if (error) return { ok: false, error: error.message };
    revalidatePath(`/properties/${propertyId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to save the manual carrier row." };
  }
}

export async function updateAssignedAgentAction(propertyId: string, formData: FormData): Promise<{ ok: true } | { ok: false; error: string }> {
  const agentId = String(formData.get("assigned_agent_id") ?? "").trim();
  try {
    const { supabase } = await sessionContext();
    const { error } = await supabase.from("properties").update({ assigned_agent_id: agentId || null }).eq("id", propertyId);
    if (error) return { ok: false, error: error.message };
    // Keeps any already-generated PDFs for this property in sync with the
    // new assignment — see regenerateExistingProposals's own doc comment
    // for why this exists (without it, a reassignment silently left every
    // prior proposal showing the old agent forever).
    await regenerateExistingProposals(propertyId);
    revalidatePath(`/properties/${propertyId}`);
    revalidatePath("/properties");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to save the assigned agent." };
  }
}

/**
 * Credits a referral partner on this property's proposals after the fact —
 * the only other way to do this is NewQuoteForm's "Co-brand with a referral
 * partner" picker, which only exists at the moment a brand-new address is
 * first queued. A property re-quoted via RunQuoteButton (no such picker) or
 * one whose partner wasn't chosen at creation had no way to add or correct
 * this afterward — confirmed live on 3969 Talah Dr, where the listing agent
 * was on file in the Listing agent field/directory but never credited on
 * the generated PDFs because nothing had set the quote request's contact_id.
 *
 * Sets contact_id on the property's most recent quote_request, same field
 * NewQuoteForm's picker writes — so this also grants that partner's own
 * portal login (if they have one) visibility into this request, same as
 * choosing them there would. That's intended: being credited on a proposal
 * and being able to see it in the portal are the same thing everywhere else
 * in this app.
 */
export async function updateCoBrandContactAction(propertyId: string, formData: FormData): Promise<{ ok: true } | { ok: false; error: string }> {
  const contactId = String(formData.get("contact_id") ?? "").trim() || null;
  try {
    const { supabase } = await sessionContext();
    const { data: latestRequest } = await supabase
      .from("quote_requests")
      .select("id")
      .eq("property_id", propertyId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!latestRequest) return { ok: false, error: "This property has no quote request yet — run a quote first." };

    const { error } = await supabase.from("quote_requests").update({ contact_id: contactId }).eq("id", latestRequest.id);
    if (error) return { ok: false, error: error.message };

    await regenerateExistingProposals(propertyId);
    revalidatePath(`/properties/${propertyId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to save the co-branded referral partner." };
  }
}

export async function recordPropertyNoteAction(propertyId: string, note: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!note.trim()) return { ok: false, error: "Add a note first." };
  try {
    const { supabase, agencyId, userEmail } = await sessionContext();
    const { error } = await supabase.from("property_notes").insert({
      agency_id: agencyId,
      property_id: propertyId,
      note: note.trim(),
      recorded_by: userEmail,
    });
    if (error) return { ok: false, error: error.message };
    revalidatePath(`/properties/${propertyId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to save the note." };
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
