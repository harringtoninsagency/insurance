import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, QuoteRequestKind, QuoteRequesterType } from "@/lib/types/database";
import { normalizeEmail, normalizePhone, cleanText } from "@/lib/contacts/normalize";

export const PUBLIC_FORM_AGENCY_ID = "ccb0a58e-0b78-4799-b236-66d1bda42f67";

export interface SubmitQuoteRequestInput {
  requesterType: QuoteRequesterType;
  /** Set only for a partner submission — looked up server-side from their session, never trusted from form input. */
  contactId?: string | null;
  requesterName: string;
  requesterEmail: string;
  requesterPhone?: string;
  requestKind: QuoteRequestKind;
  addressLine: string;
  city: string;
  state?: string;
  zipcode?: string;
  yearBuilt?: string;
  sqft?: string;
  beds?: string;
  baths?: string;
  construction?: string;
  listPrice?: string;
  dwellingA?: string;
  personalPropertyPct?: string;
}

export type SubmitResult = { ok: true; id: string } | { ok: false; error: string };

const MAX_TEXT = 200;
const KINDS: QuoteRequestKind[] = ["quote_summary", "listing_snapshot", "both"];

/** Parses a form's optional numeric field: blank stays null, anything unparseable is rejected rather than silently dropped. */
function parseOptionalNumber(raw: string | undefined, label: string): { ok: true; value: number | null } | { ok: false; error: string } {
  const trimmed = raw?.trim();
  if (!trimmed) return { ok: true, value: null };
  const value = Number(trimmed.replace(/[$,]/g, ""));
  if (!Number.isFinite(value) || value < 0) return { ok: false, error: `${label} doesn't look like a number.` };
  return { ok: true, value };
}

/**
 * Validates and inserts one quote request. Used by both the public
 * landing-page form and the partner portal's request form — the only
 * difference between them is what the caller passes for requesterType/
 * contactId, which the caller must derive itself (contactId from a verified
 * partner session, never from form input) rather than trusting the submitter.
 */
export async function submitQuoteRequest(
  supabase: SupabaseClient<Database>,
  input: SubmitQuoteRequestInput,
  options: { agencyId?: string; requestedBy?: string } = {}
): Promise<SubmitResult> {
  const name = cleanText(input.requesterName);
  if (!name) return { ok: false, error: "Please enter your name." };
  if (name.length > MAX_TEXT) return { ok: false, error: "That name is too long." };

  const email = normalizeEmail(input.requesterEmail);
  if (!email) return { ok: false, error: "Please enter a valid email address." };

  const phone = input.requesterPhone?.trim() ? normalizePhone(input.requesterPhone) : null;
  if (input.requesterPhone?.trim() && !phone) return { ok: false, error: "Please enter a 10-digit phone number, or leave it blank." };

  if (!KINDS.includes(input.requestKind)) return { ok: false, error: "Please choose what you'd like: a quote summary, a listing snapshot, or both." };

  const addressLine = cleanText(input.addressLine);
  if (!addressLine) return { ok: false, error: "Please enter the property's street address." };
  if (addressLine.length > MAX_TEXT) return { ok: false, error: "That address is too long." };

  const city = cleanText(input.city);
  if (!city) return { ok: false, error: "Please enter the property's city." };

  const zipcode = cleanText(input.zipcode);
  if (zipcode && !/^\d{5}(-\d{4})?$/.test(zipcode)) return { ok: false, error: "Please enter a valid 5-digit zip code, or leave it blank." };

  const numericFields: Array<[keyof SubmitQuoteRequestInput, string]> = [
    ["yearBuilt", "Year built"],
    ["sqft", "Square footage"],
    ["beds", "Bedrooms"],
    ["baths", "Bathrooms"],
    ["listPrice", "List price"],
    ["dwellingA", "Dwelling coverage amount"],
    ["personalPropertyPct", "Personal property percentage"],
  ];
  const parsed: Record<string, number | null> = {};
  for (const [key, label] of numericFields) {
    const result = parseOptionalNumber(input[key] as string | undefined, label);
    if (!result.ok) return result;
    parsed[key] = result.value;
  }
  if (parsed.yearBuilt != null && (parsed.yearBuilt < 1800 || parsed.yearBuilt > new Date().getFullYear() + 1)) {
    return { ok: false, error: "That year built doesn't look right." };
  }
  if (parsed.personalPropertyPct != null && (parsed.personalPropertyPct < 0 || parsed.personalPropertyPct > 100)) {
    return { ok: false, error: "Personal property percentage should be between 0 and 100." };
  }

  const { data, error } = await supabase
    .from("quote_requests")
    .insert({
      agency_id: options.agencyId ?? PUBLIC_FORM_AGENCY_ID,
      contact_id: input.contactId ?? null,
      requested_by: options.requestedBy ?? null,
      requester_type: input.requesterType,
      requester_name: name,
      requester_email: email,
      requester_phone: phone,
      request_kind: input.requestKind,
      address_line: addressLine,
      city,
      state: cleanText(input.state) ?? "FL",
      zipcode,
      year_built: parsed.yearBuilt ?? null,
      sqft: parsed.sqft ?? null,
      beds: parsed.beds ?? null,
      baths: parsed.baths ?? null,
      construction: cleanText(input.construction),
      list_price: parsed.listPrice ?? null,
      dwelling_a: parsed.dwellingA ?? null,
      personal_property_pct: parsed.personalPropertyPct ?? null,
      status: "new",
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "Something went wrong saving your request. Please try again or email us." };

  return { ok: true, id: data.id };
}
