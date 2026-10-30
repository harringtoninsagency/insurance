import { createServiceSupabase } from "@/lib/supabase/server";
import { fetchQuotingAdapter, type FetchRate } from "@/lib/adapters/fetch-quoting";
import { ingestFetchQuoteResults } from "@/lib/quotes/ingest";
import { generateIndicationProposal } from "@/lib/proposals/generate-indication";
import { generateListingSnapshotProposal } from "@/lib/proposals/generate-listing-snapshot";
import { resolveReferralPartner } from "@/lib/quote-requests/referral-partner";
import { buildQuoteCompletionEmail, buildConsumerQuoteCompletionEmail, type QuoteCompletionEmail } from "@/lib/quote-requests/completion-email";
import type { ContactType, Database } from "@/lib/types/database";

type PropertyRow = Database["public"]["Tables"]["properties"]["Row"];

/**
 * The half of quote-request processing that needs Fetch's carrier-quoting
 * tools — which only exist inside an authenticated Claude Code session (this
 * one, or a scheduled routine with the Fetch MCP connector attached), never
 * as a plain server API the deployed app can call on its own. This module is
 * the reusable, tested logic; the actual orchestration — call
 * CreateBulkQuoteRequest, poll, call GetQuoteStatus — is a short agent
 * procedure documented in docs/process-quote-requests.md that imports these
 * functions rather than reimplementing them by hand each time (which is how
 * every quote before the partner portal existed was produced in this app).
 */

export interface FetchQuoteItemSpec {
  client_item_id: string;
  fields: Record<string, string>;
  form_types?: string[];
  carrier_keys?: string[];
}

export interface CoverageOverride {
  dwellingA?: number | null;
  personalPropertyPct?: number | null;
}

const HO3_COVERAGE_C_OPTIONS = [0, 25, 50] as const;

/** Fetch only accepts these three exact option strings for ho_3_coverage_c — an arbitrary percent gets snapped to the nearest one. */
function nearestCoverageCOption(pct: number): "0%" | "25%" | "50%" {
  const nearest = HO3_COVERAGE_C_OPTIONS.reduce((a, b) => (Math.abs(b - pct) < Math.abs(a - pct) ? b : a));
  return `${nearest}%`;
}

/**
 * Builds the single-item CreateBulkQuoteRequest payload for a property: every
 * appointed carrier, every form Fetch still quotes. DP3 is a standing
 * exclusion (see EXCLUDED_FORMS below) across every carrier, so there's no
 * longer a separate DP3-only override item to build — Universal P&C's old
 * DP3 occupancy override (lib/adapters/fetch-quoting.ts) is gone with it,
 * since no DP3 rate is ever saved or shown regardless of how it was quoted.
 *
 * `runSuffix` must be unique per run (e.g. the quote_request id, or that plus
 * a retry counter) — Fetch dedupes on client_item_id and silently returns the
 * OLD results for a repeat id instead of re-quoting, confirmed earlier this
 * project.
 *
 * `roofingCompanyOverride: true` applies that referral type's own EXTRA
 * quoting rules (forces roof_year to the current calendar year, and sets the
 * extra wind-mitigation credits described in
 * lib/adapters/fetch-quoting.ts's roofingCompanyExtraWindMitFields) — set it
 * when the request's referring contact (industry_contacts, via
 * quote_requests.contact_id) has contact_type = 'roofing_company', or the
 * partner explicitly asked for "New Roof Scenario"
 * (quote_requests.requested_roof_scenario). See docs/process-quote-requests.md.
 *
 * `referralPartnerType`, when given (realtor, mortgage_broker, or
 * roofing_company — the request's referring contact's own contact_type),
 * applies that shared wind-mit trio to every referral-partner quote
 * (referralPartnerWindMitFields) — independent of roofingCompanyOverride,
 * which only a roofing_company referral or an explicit roof-scenario request
 * triggers.
 */
export function buildFetchQuoteItems(
  property: PropertyRow,
  coverage: CoverageOverride,
  runSuffix: string,
  roofingCompanyOverride = false,
  referralPartnerType: ContactType | null = null
): FetchQuoteItemSpec[] {
  const standardFields = fetchQuotingAdapter.buildQuoteFields(property, roofingCompanyOverride, referralPartnerType);

  if (coverage.dwellingA != null) {
    standardFields.dwelling_a = String(Math.round(coverage.dwellingA));
  }
  if (coverage.personalPropertyPct != null) {
    // Fetch's schema: ho_3_coverage_c "applies to HO3 quotes only — DP3, DP1,
    // and other form types keep their product defaults" — confirmed against
    // GetApplicationSchema, not left to assumption.
    standardFields.ho_3_coverage_c = nearestCoverageCOption(coverage.personalPropertyPct);
  }

  return [{ client_item_id: `${property.id}-${runSuffix}`, fields: standardFields }];
}

export interface RawFetchRate {
  id: string;
  carrier: string;
  form_type: string | null;
  status: string | null;
  premium: string | number | null;
  carrier_response_messages?: unknown;
}

// DP3 is a standing exclusion across every carrier — not a data-quality
// fix like the eligibility-warning check below, just a decision not to
// quote/show it going forward (it was previously excluded for Frontline
// only; now dropped for every carrier that returns it). HO8/DP1 are never
// shown on a proposal regardless of carrier.
const EXCLUDED_FORMS = new Set(["HO8", "DP1", "DP3"]);

/**
 * A "success" status with a real premium can still carry a substantive
 * underwriting warning in carrier_response_messages — confirmed live: rates
 * for a 1910-built home came back priced but flagged "Year of construction is
 * ineligible" (Olympus) and "Property age exceeds maximum, 76 years"
 * (Universal), both under status "success". Every quote in this app before
 * this pipeline existed had a human reading each message and excluding these
 * by hand; this makes that check automatic instead of relying on someone
 * noticing. A message array that's empty, or contains only the literal
 * string "Success", is the clean case and passes.
 */
function hasEligibilityWarning(r: RawFetchRate): boolean {
  if (!Array.isArray(r.carrier_response_messages)) return false;
  return r.carrier_response_messages.some((m) => typeof m === "string" && m.trim() !== "" && m.trim() !== "Success");
}

function isUsableRate(r: RawFetchRate): boolean {
  if (r.status !== "success") return false;
  if (!r.form_type || EXCLUDED_FORMS.has(r.form_type.toUpperCase())) return false;
  if (hasEligibilityWarning(r)) return false;
  const premium = r.premium != null ? Number(String(r.premium).replace(/,/g, "")) : null;
  return premium != null && premium > 0;
}

/**
 * Filters a Fetch item's raw rates down to what's worth saving: drops
 * declined/errored rates, excluded forms (HO8, DP1, DP3 — see
 * EXCLUDED_FORMS), any $0 or placeholder premium a "success" status can
 * still carry, and any rate carrying a real underwriting warning even
 * alongside a priced premium. Named `mergeFetchRates` for historical
 * continuity with docs/process-quote-requests.md and
 * docs/process-onehome-listings.md, though it now filters a single item's
 * rates rather than merging two (the old Universal P&C DP3 override item no
 * longer exists — see buildFetchQuoteItems).
 */
export function mergeFetchRates(rates: RawFetchRate[]): RawFetchRate[] {
  return rates.filter(isUsableRate);
}

export interface FinalizeResult {
  status: "completed" | "failed";
  proposalIds: string[];
  detail: string;
  /**
   * Set only on a completed, partner-submitted request with a PDF to send.
   * finalizeQuoteRequest cannot send this itself (see
   * buildQuoteCompletionEmail's comment) — the caller must send it via the
   * Resend MCP send-email tool, using these fields as given.
   */
  pendingEmail?: QuoteCompletionEmail | null;
}

/**
 * The non-Fetch tail end: saves the merged rates, generates both the
 * indication/quote-summary proposal and the listing-snapshot proposal
 * (crediting the referring partner when there is one), and updates the
 * request's status. Called after the caller has already run
 * CreateBulkQuoteRequest/polled/GetQuoteStatus itself.
 *
 * For a roofing_company referral, the first proposal comes back as
 * proposals.kind = "roof_scenario" ("New Roof Scenario - Insurance
 * Summary") instead of "indication" — see generateIndicationProposal's
 * roofScenario param.
 */
export async function finalizeQuoteRequest(quoteRequestId: string, standardQuoteRequestId: string, mergedRates: RawFetchRate[]): Promise<FinalizeResult> {
  const supabase = createServiceSupabase();
  const { data: request, error } = await supabase.from("quote_requests").select("*").eq("id", quoteRequestId).single();
  if (error || !request) throw new Error(`Quote request ${quoteRequestId} not found: ${error?.message ?? "no row"}`);
  if (!request.property_id) throw new Error(`Quote request ${quoteRequestId} has no matched property yet`);

  if (!mergedRates.length) {
    const detail = "No carrier returned a usable price for this property.";
    await supabase.from("quote_requests").update({ status: "failed", status_detail: detail, processed_at: new Date().toISOString() }).eq("id", quoteRequestId);
    return { status: "failed", proposalIds: [], detail };
  }

  const coverages =
    request.dwelling_a != null && request.personal_property_pct != null
      ? { dwelling_a: request.dwelling_a, personal_property_pct: request.personal_property_pct }
      : undefined;

  await ingestFetchQuoteResults(request.property_id, standardQuoteRequestId, mergedRates as FetchRate[], coverages);

  const referralPartner = await resolveReferralPartner(quoteRequestId);
  // A roofing_company referral already ran its Fetch quote under
  // roofingCompanyOverride (forced current-year roof_year — see
  // buildFetchQuoteItems/buildQuoteFields), so its "insurance summary" is
  // the "New Roof Scenario" variant instead of the plain indication — same
  // quotes, retitled and labeled so it's clear they assume a new roof. A
  // partner can also ask for this explicitly regardless of their contact
  // type (the portal's "Request a Quote Now with NEW ROOF SCENARIO"
  // button — request.requested_roof_scenario); either reason triggers it.
  const roofScenario = referralPartner?.contactType === "roofing_company" || request.requested_roof_scenario;
  const proposalIds: string[] = [];
  try {
    // Every completed request gets both documents now, regardless of which
    // one(s) request_kind asked for — the result email (and the /review
    // queue, for non-partner requests) always has the insurance summary
    // and the listing snapshot attached together.
    const [indication, listingSnapshot] = await Promise.all([
      generateIndicationProposal(request.property_id, referralPartner, quoteRequestId, roofScenario),
      generateListingSnapshotProposal(request.property_id, referralPartner, quoteRequestId),
    ]);
    proposalIds.push(indication.proposalId, listingSnapshot.proposalId);
  } catch (err) {
    const detail = `Quotes saved, but generating the PDF failed: ${err instanceof Error ? err.message : String(err)}`;
    await supabase.from("quote_requests").update({ status: "failed", status_detail: detail, processed_at: new Date().toISOString() }).eq("id", quoteRequestId);
    return { status: "failed", proposalIds, detail };
  }

  // Same end state as finalizeOneHomeListing; leave closed/dead properties alone.
  await supabase.from("properties").update({ status: "quoted" }).eq("id", request.property_id).not("status", "in", "(closed,dead)");

  const detail = `Completed with ${mergedRates.length} carrier rate(s).`;
  await supabase.from("quote_requests").update({ status: "completed", status_detail: detail, processed_at: new Date().toISOString() }).eq("id", quoteRequestId);
  // Partner-submitted and consumer (app/quote) requests get their results
  // emailed automatically — the caller sends this via the Resend MCP tool
  // (see pendingEmail's doc comment for why). Every other requester_type
  // (public, internal) stays null here and goes through the
  // producer-reviewed outreach queue on /review instead, unchanged.
  const pendingEmail =
    request.requester_type === "consumer"
      ? await buildConsumerQuoteCompletionEmail(quoteRequestId, proposalIds)
      : await buildQuoteCompletionEmail(quoteRequestId, proposalIds);
  return { status: "completed", proposalIds, detail, pendingEmail };
}
