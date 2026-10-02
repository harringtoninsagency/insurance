import { createServiceSupabase } from "@/lib/supabase/server";
import { fetchQuotingAdapter, type FetchRate } from "@/lib/adapters/fetch-quoting";
import type { QuoteCoverages } from "@/lib/quotes/coverage";
import type { Json } from "@/lib/types/database";
import { todayEt } from "@/lib/dates";

/**
 * Writes results from a Fetch quoting run (CreateQuoteRequest + GetQuoteStatus,
 * run via the Fetch MCP tools in a Claude session) into the `quotes` table.
 * Upserts on (property_id, external_rate_id) so re-ingesting the same
 * quote_request_id is safe.
 *
 * Pass `coverages` whenever the run overrode the default coverage amounts
 * (e.g. a specific Coverage A / Coverage C), so proposals can state what the
 * premiums are based on. Omit it for default runs.
 */
export async function ingestFetchQuoteResults(
  propertyId: string,
  quoteRequestId: string,
  rates: FetchRate[],
  coverages?: QuoteCoverages
) {
  const supabase = createServiceSupabase();

  const { data: property, error: propertyError } = await supabase
    .from("properties")
    .select("agency_id")
    .eq("id", propertyId)
    .single();

  if (propertyError || !property) {
    throw new Error(`Property ${propertyId} not found: ${propertyError?.message ?? "no row"}`);
  }

  const rows = rates.map((rate) => {
    const row = fetchQuotingAdapter.normalizeRate(rate, {
      agencyId: property.agency_id,
      propertyId,
      quoteRequestId,
    });
    return coverages ? { ...row, coverages: coverages as unknown as Json } : row;
  });

  const { data, error } = await supabase
    .from("quotes")
    .upsert(rows, { onConflict: "property_id,external_rate_id" })
    .select("id, carrier, premium");

  if (error) {
    throw new Error(`Failed to ingest quotes for property ${propertyId}: ${error.message}`);
  }

  // Quotes that arrive for a property nobody queued from the dashboard (a
  // listing-feed run, a manual ingest) still get a "date quoted": the day they
  // landed. A date already there (the day it was submitted) is kept.
  await supabase.from("properties").update({ date_quoted: todayEt() }).eq("id", propertyId).is("date_quoted", null);

  return data;
}
