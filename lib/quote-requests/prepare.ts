import { createServiceSupabase } from "@/lib/supabase/server";
import { applyCountyEnrichment } from "@/lib/enrichment/apply-county-enrichment";
import { describeCountyParcelMiss } from "@/lib/enrichment/county-parcels";
import { splitStreetAddress } from "@/lib/ingest/onehome-email";
import { todayEt } from "@/lib/dates";
import { notifyNeedsReview } from "@/lib/quote-requests/needs-review-notify";
import { attachOneHomePhotoIfListed } from "@/lib/proposals/onehome-photo-match";

export interface PrepareResult {
  status: "processing" | "needs_review";
  propertyId: string;
  detail: string;
}

/**
 * Runs immediately after a quote request is saved — no Fetch/MCP session
 * needed for any of this, so it happens synchronously in the same request
 * that submitted the form. Creates a dedicated property row for this request
 * and runs the same county-record enrichment every other property in this app
 * gets. Only the actual carrier-quoting step after this needs an agent
 * session (Fetch's tools are only reachable that way — see
 * docs/realtor-broker-sourcing-plan.md's sibling doc on outreach, and the
 * project status memory, for the same constraint elsewhere in this app).
 *
 * Deliberately always creates a brand-new property row rather than matching
 * an existing one: the partner-portal RLS policy grants visibility by
 * quote_requests.property_id, so if two different people's requests ever
 * pointed at the same property row, each would see the other's quote/proposal
 * history through it. One request, one property, always — no exceptions.
 *
 * Also decides flood_status here, alongside the home quote's own status, when
 * requested_flood_quote is set — see docs/process-flood-quote-requests.md.
 * Deliberately NOT gated on hasEnoughToQuote/county enrichment below:
 * RocketFlood looks up year built, square footage, construction, flood zone,
 * and both elevations itself from the address the moment an application is
 * created there (confirmed live against a real address — see that doc), so a
 * property this app couldn't match to a county record can still get a flood
 * quote. The only thing flood actually needs from here is a deliverable
 * address.
 */
export async function prepareQuoteRequest(requestId: string): Promise<PrepareResult> {
  const supabase = createServiceSupabase();
  const { data: request, error } = await supabase.from("quote_requests").select("*").eq("id", requestId).single();
  if (error || !request) throw new Error(`Quote request ${requestId} not found: ${error?.message ?? "no row"}`);

  let houseNumber: string;
  let street: string;
  try {
    ({ houseNumber, street } = splitStreetAddress(request.address_line));
  } catch {
    const detail = "Could not read a house number and street name out of the address given.";
    await supabase
      .from("quote_requests")
      .update({
        status: "needs_review",
        status_detail: detail,
        // No property ever gets created on this path, so flood can't run
        // either — mirror the home quote's own needs_review here rather than
        // leaving flood_status null, which would otherwise read as "flood
        // wasn't requested" instead of "flood couldn't start."
        ...(request.requested_flood_quote
          ? { flood_status: "needs_review", flood_status_detail: detail }
          : {}),
      })
      .eq("id", requestId);
    await notifyNeedsReview({
      requesterType: request.requester_type,
      requesterName: request.requester_name,
      requesterEmail: request.requester_email,
      addressLine: request.address_line,
      city: request.city,
      state: request.state,
      detail,
    });
    return { status: "needs_review", propertyId: "", detail };
  }

  const { data: property, error: insertError } = await supabase
    .from("properties")
    .insert({
      agency_id: request.agency_id,
      source: "quote_request",
      address: [request.address_line, request.city, `${request.state} ${request.zipcode ?? ""}`.trim()].filter(Boolean).join(", "),
      house_number: houseNumber,
      street,
      city: request.city,
      state: request.state,
      zipcode: request.zipcode,
      year_built: request.year_built,
      sqft: request.sqft,
      beds: request.beds,
      baths: request.baths,
      construction: request.construction,
      list_price: request.list_price,
      date_quoted: todayEt(),
      status: "new",
    })
    .select("id")
    .single();
  if (insertError || !property) throw new Error(`Failed to create a property for request ${requestId}: ${insertError.message}`);

  await supabase.from("quote_requests").update({ property_id: property.id }).eq("id", requestId);

  // If this home is currently listed, the OneHome ingest already has its MLS
  // front photo on a sibling property — copy it over now, before enrichment,
  // so the NAIP aerial fallback inside applyCountyEnrichment sees a photo and
  // stays out of the way. Best-effort; a miss just means the aerial is used.
  await attachOneHomePhotoIfListed(property.id);

  const enrichment = await applyCountyEnrichment(property.id);

  const { data: enriched } = await supabase.from("properties").select("year_built, sqft").eq("id", property.id).single();
  const hasEnoughToQuote = !!(enriched?.year_built && enriched?.sqft);

  const status = hasEnoughToQuote ? "processing" : "needs_review";
  const detail = hasEnoughToQuote
    ? "Matched to county records — waiting for a carrier quote."
    : enrichment.matched
      ? "Matched to a county record, but it's missing year built or square footage — a producer needs to fill these in before it can be quoted."
      : enrichment.missReason === "usps_address_not_found"
        ? describeCountyParcelMiss(enrichment.missReason)
        : `No matching county property record was found, and no year built / square footage was given with the request. ${describeCountyParcelMiss(enrichment.missReason)}`;

  // Flood eligibility: a deliverable address is all RocketFlood needs — see
  // this function's own doc comment for why that's a lower bar than
  // hasEnoughToQuote above. houseNumber/street are guaranteed non-empty here
  // (the catch block above returns before this point otherwise); city/state/
  // zipcode are the raw submitted fields and can still be blank on a sloppy
  // partner-portal submission, so they're what actually gates this.
  let floodFields: { flood_status: "processing" | "needs_review"; flood_status_detail: string } | Record<string, never> = {};
  if (request.requested_flood_quote) {
    const hasUsableAddress = !!(request.city && request.state && request.zipcode);
    floodFields = {
      flood_status: hasUsableAddress ? "processing" : "needs_review",
      flood_status_detail: hasUsableAddress
        ? "Address is complete — RocketFlood will look up flood zone, elevation, and property details itself."
        : "Request is missing city, state, or zip — RocketFlood needs a complete address to run its own lookup.",
    };
  }

  await supabase.from("quote_requests").update({ status, status_detail: detail, ...floodFields }).eq("id", requestId);
  if (status === "needs_review") {
    await notifyNeedsReview({
      requesterType: request.requester_type,
      requesterName: request.requester_name,
      requesterEmail: request.requester_email,
      addressLine: request.address_line,
      city: request.city,
      state: request.state,
      detail,
    });
  }
  return { status, propertyId: property.id, detail };
}
