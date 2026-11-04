import { createServiceSupabase } from "@/lib/supabase/server";
import type { Database } from "@/lib/types/database";

type Property = Database["public"]["Tables"]["properties"]["Row"];
type QuoteRequest = Database["public"]["Tables"]["quote_requests"]["Row"];

/**
 * What goes into RocketFlood's Quote Profile form. year built, square
 * footage, construction type, stories, garage, flood zone, and both
 * elevations are NOT here — RocketFlood looks all of that up itself from
 * the address the moment an application is created (confirmed live against
 * 2005 Vista Pkwy, West Palm Beach — see docs/process-flood-quote-requests.md).
 * This only carries what RocketFlood does NOT fill in on its own.
 */
export interface RocketFloodQuoteInput {
  address: string;
  clientFirstName: string;
  clientLastName: string;
  clientEmail: string;
  clientPhone: string;
  /**
   * Always "Single Family" for every property this pipeline handles today.
   * Hardcoded rather than derived — properties has no building-type column,
   * and every source (OneHome, partner portal, consumer re-shop) is single-
   * family homes. Revisit if a non-single-family source is ever added.
   */
  buildingType: "Single Family";
  /**
   * Defaults to "Slab" — properties/enrichments has no foundation-type
   * column, so this is an assumption, not data. Most FL homes this pipeline
   * quotes are slab-on-grade, but this will be wrong for a meaningful slice
   * of stilts/pilings coastal properties. There's no field to source a
   * correction from today; flag ones where it matters for manual review
   * rather than trusting this default blindly once real volume starts.
   */
  foundationType: RocketFloodFoundationType;
  /**
   * All six "No" — every property this pipeline handles is an existing,
   * non-mobile, non-CBRA, not-under-construction risk. True per-property
   * answers would need a source that doesn't exist yet; this is the same
   * kind of default as buildingType/foundationType above, not real data.
   */
  underwritingAnswersAllNo: true;
}

export type RocketFloodFoundationType =
  | "Slab"
  | "Crawlspace"
  | "Stilts / Pilings"
  | "Garage"
  | "Basement"
  | "Subgrade Crawlspace";

/**
 * One priced carrier card off the Quote Results grid. RocketFlood is a
 * marketplace — one application returns 15+ of these, most declined
 * ($0 premium, an "Alerts" badge with a plain-English reason). Only
 * priced cards belong in this type; drop declines before they ever reach
 * selectTopFloodCarriers.
 */
export interface RocketFloodCarrierResult {
  carrierName: string;
  premium: number;
  /** The reference/policy number shown on the card, e.g. "FL6306RDKWKRWB". Not every priced card has shown one in testing — treat as optional. */
  referenceNumber: string | null;
  /** Raw scraped text of that one card, kept for raw_response/audit — same role raw_response plays for Fetch quotes. */
  rawCardText: string;
}

/**
 * There is no RocketFlood API (confirmed by asking) — an agent session
 * drives Claude in Chrome against quotemanager.rocketflood.com to produce
 * this list, the same way an agent session calls Fetch's MCP tools to
 * produce Fetch's own `rates` array. Nothing in this file touches a
 * browser; it only shapes the inputs going in and the outputs coming back.
 * See docs/process-flood-quote-requests.md step 3b for the actual
 * navigate/fill/scrape sequence.
 */
export function buildRocketFloodQuoteInput(
  property: Property,
  request: QuoteRequest,
): RocketFloodQuoteInput {
  const address = [property.house_number, property.street]
    .filter(Boolean)
    .join(" ")
    || request.address_line
    || "";
  const city = property.city || request.city || "";
  const state = property.state || request.state || "FL";
  const zipcode = property.zipcode || request.zipcode || "";

  const requesterName = request.requester_name?.trim();
  const [clientFirstName = "Homeowner", ...rest] = requesterName
    ? requesterName.split(/\s+/)
    : ["Homeowner"];
  const clientLastName = rest.join(" ") || "Homeowner";

  return {
    address: [address, city, state, zipcode].filter(Boolean).join(", "),
    clientFirstName,
    clientLastName,
    clientEmail: request.requester_email ?? "",
    clientPhone: request.requester_phone ?? "",
    buildingType: "Single Family",
    foundationType: "Slab",
    underwritingAnswersAllNo: true,
  };
}

/**
 * Keeps the N cheapest priced carriers, ascending by premium. RocketFlood's
 * own "Recommended" badge is NOT the same ranking — in a live test it
 * marked a $933 carrier recommended while two others priced at $411 and a
 * third at $320 were all cheaper. Don't substitute "Recommended" for this.
 */
export function selectTopFloodCarriers(
  carriers: RocketFloodCarrierResult[],
  count = 3,
): RocketFloodCarrierResult[] {
  return [...carriers]
    .filter((c) => c.premium > 0)
    .sort((a, b) => a.premium - b.premium)
    .slice(0, count);
}

export interface FinalizeFloodQuoteRequestParams {
  requestId: string;
  propertyId: string;
  agencyId: string;
  /** The RocketFlood application id from the URL, e.g. "RMGA358960". Shared across every carrier row this application produced. */
  applicationId: string;
  /** Output of selectTopFloodCarriers — empty when every carrier on the application declined. */
  carriers: RocketFloodCarrierResult[];
  /** Set when carriers is empty, or when the RocketFlood run itself failed (portal error, not signed in, etc.) — becomes flood_status_detail. */
  failureReason?: string;
}

export interface FinalizeFloodQuoteRequestResult {
  status: "completed" | "failed";
  quoteIds: string[];
}

/**
 * Writes one quotes row per kept carrier (not one row for the whole
 * application) and updates quote_requests.flood_status — independently of
 * the home quote's own status/status_detail, so a flood failure never
 * blocks or gets confused with the home quote finishing successfully, and
 * vice versa. Called from the same finalize step that already handles the
 * home quote for this request (process-quote-requests.md step 5) so the
 * proposal PDF gets generated once with both results already in hand —
 * NOT on its own schedule. See docs/process-flood-quote-requests.md.
 */
export async function finalizeFloodQuoteRequest(
  params: FinalizeFloodQuoteRequestParams,
): Promise<FinalizeFloodQuoteRequestResult> {
  const supabase = createServiceSupabase();
  const { requestId, propertyId, agencyId, applicationId, carriers, failureReason } = params;

  const quoteIds: string[] = [];

  if (carriers.length > 0) {
    const rows = carriers.map((carrier) => ({
      agency_id: agencyId,
      property_id: propertyId,
      carrier: carrier.carrierName,
      adapter: "rocketflood" as const,
      form_type: "flood",
      premium: carrier.premium,
      is_indicative: true,
      external_quote_request_id: applicationId,
      external_rate_id: carrier.referenceNumber,
      raw_response: { scraped_text: carrier.rawCardText, scraped_at: new Date().toISOString() },
    }));

    // Same upsert target the home quote's own ingest uses
    // (quotes_property_carrier_form_key, 0030_dedupe_quotes_per_carrier_form.sql)
    // — NOT external_rate_id. 0030 exists precisely because Fetch mints a
    // fresh rate id on every run even for the same carrier/property, so an
    // external_rate_id-keyed upsert never actually matched and left stale
    // duplicate rows behind. RocketFlood's reference numbers are untested
    // for that same behavior, so (property_id, carrier, form_type) is the
    // safe default here too, re-quoting a property onto its existing
    // carrier rows the same way the home quote already does.
    const { data, error } = await supabase
      .from("quotes")
      .upsert(rows, { onConflict: "property_id,carrier,form_type" })
      .select("id");
    if (error) throw error;
    quoteIds.push(...(data ?? []).map((row) => row.id));
  }

  const status: FinalizeFloodQuoteRequestResult["status"] = carriers.length > 0 ? "completed" : "failed";
  const statusDetail = carriers.length > 0
    ? null
    : failureReason ?? "No RocketFlood carrier returned a usable premium";

  const { error: updateError } = await supabase
    .from("quote_requests")
    .update({
      flood_status: status,
      flood_status_detail: statusDetail,
      flood_processed_at: new Date().toISOString(),
    })
    .eq("id", requestId);
  if (updateError) throw updateError;

  return { status, quoteIds };
}
