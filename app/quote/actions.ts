"use server";

import { headers } from "next/headers";
import { createServiceSupabase } from "@/lib/supabase/server";
import { submitQuoteRequest, type SubmitQuoteRequestInput } from "@/lib/quote-requests/submit";
import { prepareQuoteRequest } from "@/lib/quote-requests/prepare";
import { fireQuoteRoutine } from "@/lib/quote-requests/fire-routine";
import { checkConsumerPropertyLimit } from "@/lib/quote-requests/rate-limit";
import { notifyConsumerQuoteSubmission } from "@/lib/quote-requests/consumer-submission-notify";
import { normalizeEmail } from "@/lib/contacts/normalize";

export type ConsumerQuoteValues = Record<string, string>;
export type ConsumerQuoteState = { done: true } | { error: string; values: ConsumerQuoteValues } | null;

// Tim Harrington (tim.harrington@brightway.com) — by explicit instruction,
// every proposal generated from this page shows only him, never a
// co-branded referral partner (which never applies here anyway: a consumer
// submission has no contact_id for resolveReferralPartner to resolve one
// from) and never whichever admin resolveProposalAgent's own
// earliest-created-admin fallback happens to land on, which could silently
// change later.
const AGENCY_OWNER_AGENT_ID = "2386c3a1-c873-4112-ad38-2997d12a4c24";

const FIELDS = ["firstName", "lastName", "email", "phone", "formattedAddress", "addressLine", "city", "state", "zipcode"] as const;

const str = (formData: FormData, key: string) => String(formData.get(key) ?? "").trim();

/**
 * The homeowner re-shop page's submission (app/quote) — the "consumer"
 * requester_type from the "Quote app access and front doors" plan. Reuses
 * the exact same submission/enrichment/quoting pipeline every other quote
 * request goes through (submitQuoteRequest -> prepareQuoteRequest's county
 * enrichment, including flood zone and distance-to-coast ->
 * fireQuoteRoutine); only the completion email differs — see
 * lib/quote-requests/completion-email.ts's buildConsumerQuoteCompletionEmail,
 * wired in from finalizeQuoteRequest by requester_type.
 *
 * Also the InstaHomeQuote landing page's submission (app/instahomequote) —
 * same form, same action, same pipeline. Which funnel it came through is
 * read off the actual Host header rather than trusted from the form, so it
 * can't be spoofed by whichever page happens to render <QuoteForm />.
 */
export async function submitConsumerQuoteAction(_prev: ConsumerQuoteState, formData: FormData): Promise<ConsumerQuoteState> {
  // Hidden honeypot: real people never fill it in.
  if (str(formData, "website")) return { done: true };

  const firstName = str(formData, "firstName");
  const lastName = str(formData, "lastName");
  // addressLine/city/state/zipcode come from AddressAutocompleteInput's
  // hidden fields, set only once Google Places actually resolved a
  // selection — never typed free-hand, so there's nothing to re-verify here.
  const addressLine = str(formData, "addressLine");
  const city = str(formData, "city");
  if (!addressLine || !city) {
    const values = Object.fromEntries(FIELDS.map((f) => [f, str(formData, f)]));
    return { error: "Choose your address from the suggestions list.", values };
  }

  const email = normalizeEmail(str(formData, "email"));
  if (!email) {
    const values = Object.fromEntries(FIELDS.map((f) => [f, str(formData, f)]));
    return { error: "Please enter a valid email address.", values };
  }

  const zipcode = str(formData, "zipcode");
  const host = (await headers()).get("host") ?? "";
  const leadSource = host.includes("instahomequote") ? "instahomequote" : null;
  const supabase = createServiceSupabase();
  const limit = await checkConsumerPropertyLimit(supabase, email, addressLine, city, zipcode || null);
  if (!limit.ok) {
    const values = Object.fromEntries(FIELDS.map((f) => [f, str(formData, f)]));
    return { error: limit.error, values };
  }

  const input: SubmitQuoteRequestInput = {
    requesterType: "consumer",
    requesterName: `${firstName} ${lastName}`.trim(),
    requesterEmail: email,
    requesterPhone: str(formData, "phone"),
    requestKind: "quote_summary",
    addressLine,
    city,
    state: str(formData, "state") || "FL",
    zipcode,
    assignedAgentId: AGENCY_OWNER_AGENT_ID,
    leadSource,
  };

  const result = await submitQuoteRequest(supabase, input);
  if (!result.ok) {
    const values = Object.fromEntries(FIELDS.map((f) => [f, str(formData, f)]));
    return { error: result.error, values };
  }

  await notifyConsumerQuoteSubmission({
    firstName,
    lastName,
    email,
    phone: str(formData, "phone"),
    formattedAddress: str(formData, "formattedAddress"),
    addressLine,
    city,
    state: str(formData, "state") || "FL",
    zipcode,
    leadSource,
  });

  // The property-matching/enrichment step needs no Fetch/agent session, so
  // it runs immediately; only the actual carrier quote after this has to
  // wait for the scheduled processor (nudged below to run within seconds).
  const prep = await prepareQuoteRequest(result.id);
  if (prep.status === "processing") {
    await fireQuoteRoutine(result.id);
  }
  return { done: true };
}
