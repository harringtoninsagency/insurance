// Bulk-loads realtor / mortgage broker contacts from a CSV into
// `industry_contacts` (dedupes and enriches — safe to re-run).
//
// Usage: npx tsx scripts/import-contacts-csv.ts <file.csv> <realtor|mortgage_broker> [source] [source note]
//   source: csv_import (default) | public_license | event | referral | other

import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
process.loadEnvFile(resolve(import.meta.dirname, "../.env.local"));

import { createServiceSupabase } from "@/lib/supabase/server";
import { importContactsCsv } from "@/lib/contacts/import-csv";
import type { ContactSource, ContactType } from "@/lib/types/database";

const AGENCY_ID = "ccb0a58e-0b78-4799-b236-66d1bda42f67";

async function main() {
  const [file, type, source = "csv_import", note] = process.argv.slice(2);
  if (!file || (type !== "realtor" && type !== "mortgage_broker")) {
    console.error("Usage: npx tsx scripts/import-contacts-csv.ts <file.csv> <realtor|mortgage_broker> [source] [source note]");
    process.exit(1);
  }

  const summary = await importContactsCsv(createServiceSupabase(), AGENCY_ID, readFileSync(resolve(file), "utf8"), {
    defaultType: type as ContactType,
    source: source as ContactSource,
    sourceDetail: note ?? basename(file),
  });

  if (summary.missingColumns.length) {
    console.error(`No column found for: ${summary.missingColumns.join("; ")}`);
    process.exit(1);
  }
  const { rejected, ...counts } = summary;
  console.log(counts);
  for (const r of rejected.slice(0, 25)) console.log(`  row ${r.row}: ${r.reason}`);
  if (rejected.length > 25) console.log(`  ...and ${rejected.length - 25} more skipped`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
