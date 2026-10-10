import { createServiceSupabase } from "@/lib/supabase/server";
import { fetchQuotingAdapter, type FetchRate } from "@/lib/adapters/fetch-quoting";
import { ingestFetchQuoteResults } from "@/lib/quotes/ingest";
import { generateIndicationProposal } from "@/lib/proposals/generate-indication";
import { generateListingSnapshotProposal } from "@/lib/proposals/generate-listing-snapshot";
import { resolveReferralPartner } from "@/lib/quote-requests/referral-partner";
import { buildQuoteCompletionEmail, type QuoteCompletionEmail } from "@/lib/quote-requests/completion-email";
import type { Database } from "@/lib/types/database";

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
 * Builds the two-item CreateBulkQuoteRequest payload for a property: the
 * standard item (every appointed carrier, every form) plus Universal P&C's
 * DP3-only override (Tenant/Rental occupancy — Universal's own standard DP3
 * quote is a bogus $128 placeholder otherwise; see
 * lib/adapters/fetch-quoting.ts's CARRIER_DP3_OCCUPANCY_OVERRIDES comment).
 *
 * `runSuffix` must be unique per run (e.g. the quote_request id, or that plus
 * a retry counter) — Fetch dedupes on client_item_id and silently returns the
 * OLD results for a repeat id instead of re-quoting, confirmed earlier this
 * project.
 */
export function buildFetchQuoteItems(property: PropertyRow, coverage: CoverageOverride, runSuffix: string): FetchQuoteItemSpec[] {
  const standardFields = fetchQuotingAdapter.buildQuoteFields(property);
  const dp3Fields = fetchQuotingAdapter.buildQuoteFields(property, "universal-p-c", "dp3");

  if (coverage.dwellingA != null) {
    standardFields.dwelling_a = String(Math.round(coverage.dwellingA));
    dp3Fields.dwelling_a = String(Math.round(coverage.dwellingA));
  }
  if (coverage.personalPropertyPct != null) {
    // Fetch's schema: ho_3_coverage_c "applies to HO3 quotes only — DP3, DP1,
    // and other form types keep their product defaults" — confirmed against
    // GetApplicationSchema, not left to assumption.
    standardFields.ho_3_coverage_c = nearestCoverageCOption(coverage.personalPropertyPct);
  }

  return [
    { client_item_id: `${property.id}-${runSuffix}`, fields: standardFields },
    { client_item_id: `upc-dp3-${property.id.slice(0, 8)}-${runSuffix}`, fields: dp3Fields, form_types: ["dp3"], carrier_keys: ["universal-p-c"] },
  ];
}

export interface RawFetchRate {
  id: string;
  carrier: string;
  form_type: string | null;
  status: string | null;
  premium: string | number | null;
  carrier_response_messages?: unknown;
}

const EXCLUDED_FORMS = new Set(["HO8", "DP1"]);

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
 * Merges the standard item's rates with the Universal P&C DP3 override
 * item's rate(s) into the final list worth saving. Drops declined/errored
 * rates, HO8 and DP1 (never shown on a proposal), any $0 or placeholder
 * premium a "success" status can still carry, and — always — the standard
 * item's own Universal P&C DP3 row, which is a $128 placeholder every time
 * (Owner occupancy isn't quotable for that carrier's DP3); the override
 * item's real DP3 rate replaces it.
 */
export function mergeFetchRates(standardRates: RawFetchRate[], dp3OverrideRates: RawFetchRate[]): RawFetchRate[] {
  const fromStandard = standardRates.filter((r) => isUsableRate(r) && !(r.carrier === "Universal P&C" && r.form_type?.toUpperCase() === "DP3"));
  const fromOverride = dp3OverrideRates.filter(isUsableRate);
  return [...fromStandard, ...fromOverride];
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
 * The non-Fetch tail end: saves the merged rates, generates whichever
 * proposal(s) the request asked for (crediting the referring partner when
 * there is one), and updates the request's status. Called after the caller
 * has already run CreateBulkQuoteRequest/polled/GetQuoteStatus itself.
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
  const proposalIds: string[] = [];
  try {
    if (request.request_kind === "quote_summary" || request.request_kind === "both") {
      const result = await generateIndicationProposal(request.property_id, referralPartner);
      proposalIds.push(result.proposalId);
    }
    if (request.request_kind === "listing_snapshot" || request.request_kind === "both") {
      const result = await generateListingSnapshotProposal(request.property_id, referralPartner);
      proposalIds.push(result.proposalId);
    }
  } catch (err) {
    const detail = `Quotes saved, but generating the PDF failed: ${err instanceof Error ? err.message : String(err)}`;
    await supabase.from("quote_requests").update({ status: "failed", status_detail: detail, processed_at: new Date().toISOString() }).eq("id", quoteRequestId);
    return { status: "failed", proposalIds, detail };
  }

  // Same end state as finalizeOneHomeListing; leave closed/dead properties alone.
  await supabase.from("properties").update({ status: "quoted" }).eq("id", request.property_id).not("status", "in", "(closed,dead)");

  const detail = `Completed with ${mergedRates.length} carrier rate(s).`;
  await supabase.from("quote_requests").update({ status: "completed", status_detail: detail, processed_at: new Date().toISOString() }).eq("id", quoteRequestId);
  // Partner-submitted requests get their results emailed — the caller sends
  // this via the Resend MCP tool (see pendingEmail's doc comment for why).
  const pendingEmail = await buildQuoteCompletionEmail(quoteRequestId, proposalIds);
  return { status: "completed", proposalIds, detail, pendingEmail };
}
