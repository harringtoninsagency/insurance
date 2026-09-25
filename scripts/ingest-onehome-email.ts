// Parses a OneHome saved-search .msg email and upserts its highlighted
// listings into `properties`.
//
// Usage: npx tsx scripts/ingest-onehome-email.ts <path-to-email.msg>

import { resolve } from "node:path";
process.loadEnvFile(resolve(import.meta.dirname, "../.env.local"));

import { parseOneHomeEmail, extractListingPhotos, readMsgHtml } from "@/lib/ingest/onehome-email";
import { applyOneHomeListings } from "@/lib/ingest/apply-onehome-listings";
import { applyOneHomePhotos } from "@/lib/ingest/apply-onehome-photos";

const AGENCY_ID = "ccb0a58e-0b78-4799-b236-66d1bda42f67";

async function main() {
  const path = process.argv[2];
  if (!path) {
    console.error("Usage: npx tsx scripts/ingest-onehome-email.ts <path-to-email.msg>");
    process.exit(1);
  }

  const listings = parseOneHomeEmail(resolve(path));
  console.log(`Parsed ${listings.length} highlighted listing(s):`);
  console.table(listings.map((l) => ({ mls: l.mlsId, address: l.streetAddress, price: l.listPrice })));

  const result = await applyOneHomeListings(AGENCY_ID, listings);
  console.log(`Inserted ${result.inserted}, updated ${result.updated}, skipped ${result.skipped}.`);

  const photos = extractListingPhotos(readMsgHtml(resolve(path)));
  const photoResult = await applyOneHomePhotos(AGENCY_ID, photos, { dryRun: process.argv.includes("--dry-run-photos") });
  console.log(`Photos: found ${photos.length} — ${JSON.stringify(photoResult)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
