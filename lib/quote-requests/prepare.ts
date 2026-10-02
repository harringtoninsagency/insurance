import { createServiceSupabase } from "@/lib/supabase/server";
import { applyCountyEnrichment } from "@/lib/enrichment/apply-county-enrichment";
import { splitStreetAddress } from "@/lib/ingest/onehome-email";
import { todayEt } from "@/lib/dates";

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
    await supabase.from("quote_requests").update({ status: "needs_review", status_detail: detail }).eq("id", requestId);
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

  const enrichment = await applyCountyEnrichment(property.id);

  const { data: enriched } = await supabase.from("properties").select("year_built, sqft").eq("id", property.id).single();
  const hasEnoughToQuote = !!(enriched?.year_built && enriched?.sqft);

  const status = hasEnoughToQuote ? "processing" : "needs_review";
  const detail = hasEnoughToQuote
    ? "Matched to county records — waiting for a carrier quote."
    : enrichment.matched
      ? "Matched to a county record, but it's missing year built or square footage — a producer needs to fill these in before it can be quoted."
      : "No matching county property record was found, and no year built / square footage was given with the request. A producer needs to add these by hand before it can be quoted.";

  await supabase.from("quote_requests").update({ status, status_detail: detail }).eq("id", requestId);
  return { status, propertyId: property.id, detail };
}
