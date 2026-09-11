// Turns Fetch MCP quoting results into `quotes` rows.
//
// Usage: npx tsx scripts/ingest-fetch-quotes.ts <path-to-results.json>
//
// The JSON file is whatever a Claude session assembles after calling
// CreateQuoteRequest + GetQuoteStatus(include_rates: true) via the Fetch
// Quoting MCP tools:
//   { "propertyId": "...", "quoteRequestId": "...", "rates": [ ... ] }

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ingestFetchQuoteResults } from "@/lib/quotes/ingest";

process.loadEnvFile(resolve(import.meta.dirname, "../.env.local"));

async function main() {
  const path = process.argv[2];
  if (!path) {
    console.error("Usage: npx tsx scripts/ingest-fetch-quotes.ts <path-to-results.json>");
    process.exit(1);
  }

  const payload = JSON.parse(readFileSync(resolve(path), "utf-8"));
  const { propertyId, quoteRequestId, rates } = payload;

  if (!propertyId || !quoteRequestId || !Array.isArray(rates)) {
    console.error("Expected JSON shape: { propertyId, quoteRequestId, rates: [] }");
    process.exit(1);
  }

  const inserted = await ingestFetchQuoteResults(propertyId, quoteRequestId, rates);
  console.log(`Ingested ${inserted?.length ?? 0} quote(s) for property ${propertyId}:`);
  console.table(inserted);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
