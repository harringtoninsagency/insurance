import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, QuoteRequestKind } from "@/lib/types/database";
import { applyCountyEnrichment } from "@/lib/enrichment/apply-county-enrichment";
import { splitStreetAddress } from "@/lib/ingest/onehome-email";
import { submitQuoteRequest, type SubmitQuoteRequestInput } from "@/lib/quote-requests/submit";
import { prepareQuoteRequest } from "@/lib/quote-requests/prepare";
import { escapeLike } from "@/lib/contacts/upsert-contact";
import { todayEt } from "@/lib/dates";

type Client = SupabaseClient<Database>;

export interface Requester {
  userId: string;
  name: string;
  email: string;
  agencyId: string;
}

export type QueueResult =
  | { ok: true; propertyId: string; requestId: string; alreadyQueued: boolean; detail: string }
  | { ok: false; error: string };

const QUEUED_DETAIL = "Queued by a team member — waiting for the next carrier-quote run.";

/**
 * Queues a carrier quote for a property already in the system. Writes the same
 * quote_requests row the public form and partner portal produce, so the
 * scheduled routine picks it up unchanged — Fetch's quoting tools are only
 * reachable from an agent session, so nothing here can quote instantly.
 *
 * Unlike a partner's request, this reuses the existing property row: the
 * one-property-per-request rule exists so partners can't see each other's
 * history through a shared row, and an internal request has no partner.
 */
export async function queuePropertyQuote(supabase: Client, propertyId: string, requester: Requester, kind: QuoteRequestKind): Promise<QueueResult> {
  const { data: property } = await supabase.from("properties").select("*").eq("id", propertyId).maybeSingle();
  if (!property) return { ok: false, error: "Property not found." };

  const { data: pending } = await supabase
    .from("quote_requests")
    .select("id")
    .eq("property_id", propertyId)
    .in("status", ["new", "processing"])
    .limit(1);
  if (pending?.[0]) {
    return { ok: true, propertyId, requestId: pending[0].id, alreadyQueued: true, detail: "A quote for this property is already queued." };
  }

  let ready = property;
  if (!ready.year_built || !ready.sqft) {
    await applyCountyEnrichment(propertyId);
    const { data } = await supabase.from("properties").select("*").eq("id", propertyId).single();
    if (data) ready = data;
  }
  if (!ready.year_built || !ready.sqft) {
    return { ok: false, error: "This property is missing year built or square footage, and no county record was found to fill them in." };
  }
  if (!ready.house_number || !ready.street || !ready.city || !ready.zipcode) {
    return { ok: false, error: "This property is missing a street address, city, or zip code the carriers require." };
  }

  const { data: request, error } = await supabase
    .from("quote_requests")
    .insert({
      agency_id: ready.agency_id,
      requester_type: "internal",
      requested_by: requester.userId,
      requester_name: requester.name,
      requester_email: requester.email,
      request_kind: kind,
      address_line: `${ready.house_number} ${ready.street}`,
      city: ready.city,
      state: ready.state,
      zipcode: ready.zipcode,
      status: "processing",
      status_detail: QUEUED_DETAIL,
      property_id: propertyId,
    })
    .select("id")
    .single();
  if (error || !request) return { ok: false, error: `Couldn't queue the quote: ${error?.message ?? "no row returned"}` };

  // "Date quoted" defaults to the date the quote was submitted.
  await supabase.from("properties").update({ date_quoted: todayEt() }).eq("id", propertyId);

  return { ok: true, propertyId, requestId: request.id, alreadyQueued: false, detail: QUEUED_DETAIL };
}

export type NewAddressInput = Omit<SubmitQuoteRequestInput, "requesterType" | "requesterName" | "requesterEmail" | "contactId">;

/**
 * Queues a quote for an address typed in by hand. If that address is already a
 * property in the system, the quote is queued against it (no duplicate row);
 * otherwise a new property is created and matched to county records.
 */
export async function queueNewAddressQuote(supabase: Client, input: NewAddressInput, requester: Requester): Promise<QueueResult> {
  try {
    const { houseNumber, street } = splitStreetAddress(input.addressLine.trim());
    let match = supabase
      .from("properties")
      .select("id")
      .eq("agency_id", requester.agencyId)
      .ilike("house_number", escapeLike(houseNumber))
      .ilike("street", escapeLike(street))
      .ilike("city", escapeLike(input.city.trim()));
    if (input.zipcode?.trim()) match = match.eq("zipcode", input.zipcode.trim());
    const { data: existing } = await match.limit(1);
    if (existing?.[0]) return queuePropertyQuote(supabase, existing[0].id, requester, input.requestKind);
  } catch {
    // An address with no leading house number can't be matched here; submit/prepare below reports that properly.
  }

  const submitted = await submitQuoteRequest(
    supabase,
    { ...input, requesterType: "internal", requesterName: requester.name, requesterEmail: requester.email },
    { agencyId: requester.agencyId, requestedBy: requester.userId }
  );
  if (!submitted.ok) return submitted;

  const prepared = await prepareQuoteRequest(submitted.id);
  if (prepared.status === "needs_review") return { ok: false, error: prepared.detail };
  return { ok: true, propertyId: prepared.propertyId, requestId: submitted.id, alreadyQueued: false, detail: QUEUED_DETAIL };
}
