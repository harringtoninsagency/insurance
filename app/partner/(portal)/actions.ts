"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase, createServiceSupabase } from "@/lib/supabase/server";
import { submitQuoteRequest, type SubmitQuoteRequestInput } from "@/lib/quote-requests/submit";
import { prepareQuoteRequest } from "@/lib/quote-requests/prepare";
import { fireQuoteRoutine } from "@/lib/quote-requests/fire-routine";

export type PartnerRequestValues = Record<string, string>;
export type PartnerRequestState = { done: { status: string } } | { error: string; values: PartnerRequestValues } | null;

const FIELDS = ["requesterName", "requesterEmail", "requesterPhone", "requestKind", "addressLine", "city", "state", "zipcode", "yearBuilt", "sqft", "beds", "baths", "construction", "listPrice"] as const;

const str = (formData: FormData, key: string) => String(formData.get(key) ?? "").trim();

/**
 * The partner-portal version of quote-request submission. contactId always
 * comes from the caller's own verified session — a partner can never submit
 * a request tagged as someone else, no matter what a form field might say.
 */
export async function submitPartnerQuoteRequestAction(_prev: PartnerRequestState, formData: FormData): Promise<PartnerRequestState> {
  const session = await createServerSupabase();
  const {
    data: { user },
  } = await session.auth.getUser();
  if (!user) return { error: "Your session has expired — please sign in again.", values: {} };

  const service = createServiceSupabase();
  const { data: account } = await service.from("partner_accounts").select("agency_id, contact_id, status").eq("user_id", user.id).maybeSingle();
  if (!account || account.status !== "active") return { error: "Your partner account isn't active. Contact your Brightway representative.", values: {} };

  const { data: contact } = await service.from("industry_contacts").select("full_name, email").eq("id", account.contact_id).single();

  const input: SubmitQuoteRequestInput = {
    requesterType: "partner",
    contactId: account.contact_id,
    // A partner's own directory identity is the requester, but let them
    // override the email/phone a lead should actually reach (e.g. their own
    // preferred inbox) rather than forcing whatever's on file.
    requesterName: contact?.full_name ?? "Partner",
    requesterEmail: str(formData, "requesterEmail") || contact?.email || "",
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

  const result = await submitQuoteRequest(service, input);
  if (!result.ok) {
    const values = Object.fromEntries(FIELDS.map((f) => [f, str(formData, f)]));
    return { error: result.error, values };
  }

  const prep = await prepareQuoteRequest(result.id);
  // Matches the internal "Run quote now" flow (app/(dash)/quote-requests/actions.ts):
  // nudge the quoting routine to run within seconds instead of waiting for its
  // hourly schedule. Never throws, and a failed fire still leaves the request
  // queued for the hourly run — see lib/quote-requests/fire-routine.ts.
  if (prep.status === "processing") {
    await fireQuoteRoutine(result.id);
  }
  revalidatePath("/partner");
  return { done: { status: prep.status } };
}
