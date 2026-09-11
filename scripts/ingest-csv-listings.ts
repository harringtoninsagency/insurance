// Parses a "homes for sale" CSV export and upserts its listings into
// `properties`.
//
// Usage: npx tsx scripts/ingest-csv-listings.ts <path-to-listings.csv>

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
process.loadEnvFile(resolve(import.meta.dirname, "../.env.local"));

import { parseListingsCsv } from "@/lib/ingest/csv-listings";
import { applyOneHomeListings } from "@/lib/ingest/apply-onehome-listings";

const AGENCY_ID = "ccb0a58e-0b78-4799-b236-66d1bda42f67";

async function main() {
  const path = process.argv[2];
  if (!path) {
    console.error("Usage: npx tsx scripts/ingest-csv-listings.ts <path-to-listings.csv>");
    process.exit(1);
  }

  const csvText = readFileSync(resolve(path), "utf-8");
  const listings = parseListingsCsv(csvText);
  console.log(`Parsed ${listings.length} listing(s) from ${path}.`);

  const result = await applyOneHomeListings(AGENCY_ID, listings);
  console.log(`Inserted ${result.inserted}, updated ${result.updated}, skipped ${result.skipped}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
