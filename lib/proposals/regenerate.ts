import { createServiceSupabase } from "@/lib/supabase/server";
import { generateIndicationProposal } from "@/lib/proposals/generate-indication";
import { generateListingSnapshotProposal } from "@/lib/proposals/generate-listing-snapshot";
import { resolveReferralPartner } from "@/lib/quote-requests/referral-partner";

/**
 * Regenerates a property's existing proposals in place (new version, same
 * kind(s)) so an already-quoted property's PDFs pick up a changed agent
 * assignment — without this, generateIndicationProposal/
 * generateListingSnapshotProposal only ever run once, at the moment a quote
 * completes, so reassigning the agent afterward left every previously-
 * generated PDF silently showing the old one (or the agency's default
 * fallback admin) indefinitely. Confirmed live: 12 of 15 already-quoted,
 * agent-assigned properties were showing a stale or missing agent before
 * this existed.
 *
 * Only regenerates kinds that already exist for this property — never
 * creates a proposal type nobody asked for yet. A property with no
 * proposals at all is a no-op (nothing to keep in sync).
 *
 * Best-effort: never throws. The caller's own assignment update (the thing
 * the person actually asked for) must succeed regardless of whether a
 * regeneration here fails — e.g. a property with no priced quotes yet would
 * fail generateIndicationProposal's "no priced quotes" check, which isn't a
 * reason to roll back the agent assignment itself.
 */
export async function regenerateExistingProposals(propertyId: string): Promise<void> {
  try {
    const supabase = createServiceSupabase();
    const { data: proposals } = await supabase.from("proposals").select("kind").eq("property_id", propertyId);
    if (!proposals?.length) return;
    const kinds = new Set(proposals.map((p) => p.kind));

    const { data: latestRequest } = await supabase
      .from("quote_requests")
      .select("id, contact_id, requested_roof_scenario")
      .eq("property_id", propertyId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const quoteRequestId = latestRequest?.id ?? null;
    const referralPartner = await resolveReferralPartner(quoteRequestId);
    const roofScenario = referralPartner?.contactType === "roofing_company" || latestRequest?.requested_roof_scenario === true;

    if (kinds.has("indication") || kinds.has("roof_scenario")) {
      await generateIndicationProposal(propertyId, referralPartner, quoteRequestId, roofScenario).catch((err) =>
        console.error(`regenerateExistingProposals: indication/roof_scenario failed for property ${propertyId}: ${err instanceof Error ? err.message : err}`)
      );
    }
    if (kinds.has("listing_snapshot")) {
      await generateListingSnapshotProposal(propertyId, referralPartner, quoteRequestId).catch((err) =>
        console.error(`regenerateExistingProposals: listing_snapshot failed for property ${propertyId}: ${err instanceof Error ? err.message : err}`)
      );
    }
  } catch (err) {
    console.error(`regenerateExistingProposals: unexpected failure for property ${propertyId}: ${err instanceof Error ? err.message : err}`);
  }
}

/**
 * Same idea, but for a referral-partner-contact-level agent change
 * (industry_contacts.referral_partner_agent_id) — the lowest-priority rung
 * in resolveProposalAgent's precedence, so it only actually changes what
 * shows for a property when that property has no agent of its own AND its
 * own most recent quote request has no agent of its own either. Scoped to
 * just this contact's properties, not an agency-wide scan.
 */
export async function regeneratePropertiesForContactAgentChange(contactId: string): Promise<void> {
  try {
    const supabase = createServiceSupabase();
    const { data: requests } = await supabase
      .from("quote_requests")
      .select("property_id")
      .eq("contact_id", contactId)
      .not("property_id", "is", null)
      .order("created_at", { ascending: false });
    const propertyIds = [...new Set((requests ?? []).map((r) => r.property_id as string))];

    for (const propertyId of propertyIds) {
      const { data: property } = await supabase.from("properties").select("assigned_agent_id").eq("id", propertyId).maybeSingle();
      if (property?.assigned_agent_id) continue; // property-level assignment already wins — this contact-level change can't affect it

      const { data: latestRequest } = await supabase
        .from("quote_requests")
        .select("contact_id, assigned_agent_id")
        .eq("property_id", propertyId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latestRequest?.contact_id === contactId && !latestRequest.assigned_agent_id) {
        await regenerateExistingProposals(propertyId);
      }
    }
  } catch (err) {
    console.error(`regeneratePropertiesForContactAgentChange: unexpected failure for contact ${contactId}: ${err instanceof Error ? err.message : err}`);
  }
}
