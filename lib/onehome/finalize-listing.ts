import { createServiceSupabase } from "@/lib/supabase/server";
import { ingestFetchQuoteResults } from "@/lib/quotes/ingest";
import { generateListingSnapshotProposal } from "@/lib/proposals/generate-listing-snapshot";
import type { RawFetchRate } from "@/lib/quote-requests/fetch-pipeline";
import type { FetchRate } from "@/lib/adapters/fetch-quoting";

/**
 * The non-Fetch tail end for a property that came in through the OneHome
 * ingest (new listing, no quote_requests row) rather than the public/partner
 * quote-request portal — saves the merged rates, generates the buyer-facing
 * listing snapshot PDF (photo included automatically if
 * lib/ingest/apply-onehome-photos.ts already attached one), and marks the
 * property `quoted` so a later ingest run skips it instead of re-quoting the
 * same listing every day it's still in OneHome's "highlighted" digest.
 *
 * Deliberately does not send or email anything — generate-and-store only, so
 * a producer reviews before anything goes out. Mirrors
 * lib/quote-requests/fetch-pipeline.ts's finalizeQuoteRequest, minus the
 * quote_requests bookkeeping that doesn't apply here.
 */
export interface FinalizeOneHomeListingResult {
  status: "quoted" | "failed";
  proposalId: string | null;
  detail: string;
}

export async function finalizeOneHomeListing(
  propertyId: string,
  standardQuoteRequestId: string,
  mergedRates: RawFetchRate[]
): Promise<FinalizeOneHomeListingResult> {
  const supabase = createServiceSupabase();

  if (!mergedRates.length) {
    const detail = "No carrier returned a usable price for this listing.";
    return { status: "failed", proposalId: null, detail };
  }

  await ingestFetchQuoteResults(propertyId, standardQuoteRequestId, mergedRates as FetchRate[]);

  try {
    const result = await generateListingSnapshotProposal(propertyId);
    const { error } = await supabase.from("properties").update({ status: "quoted" }).eq("id", propertyId);
    if (error) throw new Error(`Quotes and proposal saved, but updating status failed: ${error.message}`);
    return { status: "quoted", proposalId: result.proposalId, detail: `Quoted with ${mergedRates.length} carrier rate(s).` };
  } catch (err) {
    const detail = `Quotes saved, but generating the listing snapshot failed: ${err instanceof Error ? err.message : String(err)}`;
    return { status: "failed", proposalId: null, detail };
  }
}
