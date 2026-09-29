"use server";

import { createServiceSupabase } from "@/lib/supabase/server";
import { submitQuoteRequest, type SubmitQuoteRequestInput } from "@/lib/quote-requests/submit";
import { prepareQuoteRequest } from "@/lib/quote-requests/prepare";

export type RequestQuoteValues = Record<string, string>;
export type RequestQuoteState = { done: { status: string } } | { error: string; values: RequestQuoteValues } | null;

const FIELDS = [
  "requesterName",
  "requesterEmail",
  "requesterPhone",
  "requestKind",
  "addressLine",
  "city",
  "state",
  "zipcode",
  "yearBuilt",
  "sqft",
  "beds",
  "baths",
  "construction",
  "listPrice",
] as const;

const str = (formData: FormData, key: string) => String(formData.get(key) ?? "").trim();

// Public, unauthenticated endpoint. Anyone can submit a property here —
// there's no directory contact behind it, so contactId always stays null.
export async function submitPublicQuoteRequestAction(_prev: RequestQuoteState, formData: FormData): Promise<RequestQuoteState> {
  // Hidden honeypot: real people never fill it in.
  if (str(formData, "website")) return { done: { status: "processing" } };

  const input: SubmitQuoteRequestInput = {
    requesterType: "public",
    requesterName: str(formData, "requesterName"),
    requesterEmail: str(formData, "requesterEmail"),
    requesterPhone: str(formData, "requesterPhone"),
    requestKind: str(formData, "requestKind") as SubmitQuoteRequestInput["requestKind"],
    addressLine: str(formData, "addressLine"),
    city: str(formData, "city"),
    state: str(formData, "state") || "FL",
    zipcode: str(formData, "zipcode"),
    yearBuilt: str(formData, "yearBuilt"),
    sqft: str(formData, "sqft"),
    beds: str(formData, "beds"),
    baths: str(formData, "baths"),
    construction: str(formData, "construction"),
    listPrice: str(formData, "listPrice"),
  };

  const supabase = createServiceSupabase();
  const result = await submitQuoteRequest(supabase, input);
  if (!result.ok) {
    const values = Object.fromEntries(FIELDS.map((f) => [f, str(formData, f)]));
    return { error: result.error, values };
  }

  // The property-matching step needs no Fetch/agent session, so it runs
  // immediately; only the actual carrier quote after this has to wait for a
  // producer or the scheduled processor.
  const prep = await prepareQuoteRequest(result.id);
  return { done: { status: prep.status } };
}
