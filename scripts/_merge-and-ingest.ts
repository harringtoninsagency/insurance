import { resolve } from "node:path";
import { readFileSync } from "node:fs";

process.loadEnvFile(resolve(import.meta.dirname, "../.env.local"));

interface RawRate {
  id: string;
  carrier: string;
  form_type?: string | null;
  status?: string | null;
  premium?: number | string | null;
}

interface QuoteResultEntry {
  client_item_id: string;
  quote_request_id: string;
  rates: RawRate[];
}

interface Property {
  id: string;
  address?: string;
  [key: string]: unknown;
}

const candidatesPath = resolve(import.meta.dirname, "_quote-candidates.json");
const resultsPath = resolve(import.meta.dirname, "_quote-results.json");

const candidates: Property[] = JSON.parse(readFileSync(candidatesPath, "utf8"));
const results: QuoteResultEntry[] = JSON.parse(readFileSync(resultsPath, "utf8"));

const byClientItemId = new Map<string, QuoteResultEntry>();
for (const r of results) {
  byClientItemId.set(r.client_item_id, r);
}

async function main() {
  const { ingestFetchQuoteResults } = await import("../lib/quotes/ingest");

  let ingestedCount = 0;
  let totalRows = 0;
  let errorCount = 0;
  const errors: { propertyId: string; address?: string; error: string }[] = [];

  for (const property of candidates) {
    const propertyId = property.id;
    const overrideKey = `upc-dp3-${propertyId.slice(0, 8)}`;

    try {
      const standardResult = byClientItemId.get(propertyId);
      const overrideResult = byClientItemId.get(overrideKey);

      if (!standardResult) {
        throw new Error(`No standard result found for property ${propertyId}`);
      }
      if (!overrideResult) {
        throw new Error(`No override (Universal P&C DP3) result found for property ${propertyId}`);
      }

      const filteredStandardRates = standardResult.rates.filter(
        (rate) => !(rate.carrier === "Universal P&C" && (rate.form_type ?? "").toUpperCase() === "DP3")
      );

      const mergedRates = [...filteredStandardRates, ...overrideResult.rates];

      const inserted = await ingestFetchQuoteResults(
        propertyId,
        standardResult.quote_request_id,
        mergedRates
      );

      ingestedCount++;
      totalRows += inserted?.length ?? 0;
    } catch (err) {
      errorCount++;
      errors.push({
        propertyId,
        address: property.address,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  console.log(
    JSON.stringify(
      {
        propertiesIngested: ingestedCount,
        totalQuoteRows: totalRows,
        errorCount,
        errors,
      },
      null,
      2
    )
  );
}

main();
