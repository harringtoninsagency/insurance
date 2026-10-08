// Scheduled-task entry point: polls the configured mailbox for recent
// OneHome saved-search emails, upserts any highlighted listings into
// `properties`, pulls county enrichment for newly-touched ones, then queues
// a carrier quote for anything that's enriched enough to quote and not
// already queued/quoted — the same quote_requests row "Run quote now"
// produces, so the scheduled routine (or the immediate fire below) picks it
// up unchanged. See docs/process-quote-requests.md for that half.
//
// Usage: npx tsx scripts/auto-ingest-onehome.ts

import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
process.loadEnvFile(resolve(import.meta.dirname, "../.env.local"));

import { fetchRecentMailBodies, fetchMessageHtmlBody } from "@/lib/ingest/graph-mail";
import { parseOneHomeListingsFromText, extractListingPhotos, type ParsedListing, type ListingPhoto } from "@/lib/ingest/onehome-email";
import { applyOneHomeListings } from "@/lib/ingest/apply-onehome-listings";
import { applyOneHomePhotos } from "@/lib/ingest/apply-onehome-photos";
import { applyCountyEnrichment } from "@/lib/enrichment/apply-county-enrichment";
import { createServiceSupabase } from "@/lib/supabase/server";
import { sendSlackAlert } from "@/lib/alerts/slack";
import { queuePropertyQuote, type Requester } from "@/lib/quote-requests/queue-quote";
import { fireQuoteRoutine } from "@/lib/quote-requests/fire-routine";

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
  const allPhotos: ListingPhoto[] = [];
  let matchingMessages = 0;
  for (const message of messages) {
    const listings = parseOneHomeListingsFromText(message.bodyText);
    if (listings.length === 0) continue;
    matchingMessages += 1;
    log(`  "${message.subject}" (${message.receivedDateTime}): ${listings.length} listing(s)`);
    allListings.push(...listings);

    // The plain-text body above has no <img> tags; only a matched message's
    // HTML is worth the extra Graph call to find its listing photos.
    try {
      const html = await fetchMessageHtmlBody(message.id);
      allPhotos.push(...extractListingPhotos(html));
    } catch (err) {
      log(`  Couldn't fetch HTML body for photos on "${message.subject}": ${(err as Error).message}`);
    }
  }

  if (allListings.length === 0) {
    log("No OneHome listing emails found in the lookback window. Nothing to do.");
    return;
  }

  log(`Parsed ${allListings.length} listing(s) across ${matchingMessages} email(s). Upserting...`);
  const result = await applyOneHomeListings(AGENCY_ID, allListings);
  log(`Upsert result: ${result.inserted} inserted, ${result.updated} updated, ${result.skipped} skipped.`);

  if (allPhotos.length > 0) {
    const photoResult = await applyOneHomePhotos(AGENCY_ID, allPhotos);
    log(`Photos: found ${allPhotos.length} — ${JSON.stringify(photoResult)}.`);
  }

  // Enrich anything new or updated that isn't already enriched, so it's
  // ready for quoting without a separate manual "Pull county data" click.
  const supabase = createServiceSupabase();
  const mlsIds = allListings.map((l) => l.mlsId);
  const { data: touchedProperties, error } = await supabase
    .from("properties")
    .select("id, mls_id, status")
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

  // Queue a carrier quote for anything not already quoted (status stays
  // "new" until a quote completes). queuePropertyQuote is idempotent — a
  // property already sitting in new/processing on quote_requests is
  // reported back as alreadyQueued rather than duplicated, so re-running
  // this against the same listing (or one that previously failed to quote
  // and is being retried) is always safe.
  const requester: Requester = {
    userId: null,
    name: "OneHome auto-ingest",
    email: process.env.ONEHOME_MAILBOX ?? "automation@fetchrival.internal",
    agencyId: AGENCY_ID,
  };
  const toQuote = (touchedProperties ?? []).filter((p) => p.status === "new");
  let queuedCount = 0;
  let firedCount = 0;
  for (const property of toQuote) {
    const result = await queuePropertyQuote(supabase, property.id, requester, "both");
    if (!result.ok) {
      log(`  Couldn't queue a quote for property ${property.id} (mls ${property.mls_id}): ${result.error}`);
      continue;
    }
    if (result.alreadyQueued) continue;
    queuedCount += 1;
    const fired = await fireQuoteRoutine(result.requestId);
    if (fired.started) firedCount += 1;
    else log(`  Queued property ${property.id} (mls ${property.mls_id}) but couldn't start the quote run now (${fired.reason}); the hourly run will pick it up.`);
  }
  log(`Queued ${queuedCount} new quote request(s) out of ${toQuote.length} unquoted touched properties; started the quote run immediately for ${firedCount} of them.`);
  log("Done.");
}

main().catch((err) => {
  log(`FAILED: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  process.exit(1);
});
