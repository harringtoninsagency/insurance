// Scheduled-task entry point: polls the configured mailbox for recent
// OneHome saved-search emails, upserts any highlighted listings into
// `properties`, and pulls county enrichment for newly-touched ones.
// Deliberately stops there — running Fetch quotes still requires an agent
// session (see README's "Automated OneHome ingest" section).
//
// Usage: npx tsx scripts/auto-ingest-onehome.ts

import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
process.loadEnvFile(resolve(import.meta.dirname, "../.env.local"));

import { fetchRecentMailBodies } from "@/lib/ingest/graph-mail";
import { parseOneHomeListingsFromText, type ParsedListing } from "@/lib/ingest/onehome-email";
import { applyOneHomeListings } from "@/lib/ingest/apply-onehome-listings";
import { applyCountyEnrichment } from "@/lib/enrichment/apply-county-enrichment";
import { createServiceSupabase } from "@/lib/supabase/server";
import { sendSlackAlert } from "@/lib/alerts/slack";

const AGENCY_ID = "ccb0a58e-0b78-4799-b236-66d1bda42f67";
// Wider than the daily cadence this is meant to run on, so a missed run (the
// machine was off, etc.) doesn't silently drop a day's listings. Upserting
// the same listing twice is a no-op via the (agency_id, mls_id) key.
const LOOKBACK_HOURS = 36;

const LOG_DIR = resolve(import.meta.dirname, "../logs");
const LOG_FILE = resolve(LOG_DIR, "onehome-auto-ingest.log");

function log(line: string) {
  const stamped = `[${new Date().toISOString()}] ${line}`;
  console.log(stamped);
  if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
  appendFileSync(LOG_FILE, stamped + "\n");
}

async function main() {
  log(`Checking mailbox for OneHome emails from the last ${LOOKBACK_HOURS}h...`);

  const messages = await fetchRecentMailBodies(LOOKBACK_HOURS);
  log(`Fetched ${messages.length} message(s) from the mailbox.`);

  const allListings: ParsedListing[] = [];
  let matchingMessages = 0;
  for (const message of messages) {
    const listings = parseOneHomeListingsFromText(message.bodyText);
    if (listings.length === 0) continue;
    matchingMessages += 1;
    log(`  "${message.subject}" (${message.receivedDateTime}): ${listings.length} listing(s)`);
    allListings.push(...listings);
  }

  if (allListings.length === 0) {
    log("No OneHome listing emails found in the lookback window. Nothing to do.");
    return;
  }

  log(`Parsed ${allListings.length} listing(s) across ${matchingMessages} email(s). Upserting...`);
  const result = await applyOneHomeListings(AGENCY_ID, allListings);
  log(`Upsert result: ${result.inserted} inserted, ${result.updated} updated, ${result.skipped} skipped.`);

  // Enrich anything new or updated that isn't already enriched, so it's
  // ready for quoting without a separate manual "Pull county data" click.
  const supabase = createServiceSupabase();
  const mlsIds = allListings.map((l) => l.mlsId);
  const { data: touchedProperties, error } = await supabase
    .from("properties")
    .select("id, mls_id")
    .eq("agency_id", AGENCY_ID)
    .in("mls_id", mlsIds);
  if (error) {
    log(`Warning: could not look up touched properties for enrichment: ${error.message}`);
    return;
  }

  let enrichedCount = 0;
  for (const property of touchedProperties ?? []) {
    try {
      const { matched } = await applyCountyEnrichment(property.id);
      if (matched) enrichedCount += 1;
    } catch (err) {
      log(`  Enrichment failed for property ${property.id} (mls ${property.mls_id}): ${(err as Error).message}`);
    }
  }
  log(`Enriched ${enrichedCount} of ${touchedProperties?.length ?? 0} touched properties with county data.`);
  log("Done. Quoting still requires asking Claude to run the bulk-quote pipeline for these properties.");
}

main().catch((err) => {
  log(`FAILED: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  process.exit(1);
});
