// One-time (re-runnable) backfill: re-runs applyCountyEnrichment (the same
// function "Pull county data" calls) for every property that doesn't have a
// flood_zone yet — the only way flood_zone/dist_to_coast_miles get populated
// is through that function, and it only ever ran for new ingests or a manual
// "Pull county data" click, so every property already in the system before
// migration 0019 (flood zone + coastline) needs one pass to catch up.
//
// Usage: npx tsx scripts/backfill-flood-zone-and-coastline.ts

import { loadEnvIfPresent } from "@/lib/env";
loadEnvIfPresent();

import { createServiceSupabase } from "@/lib/supabase/server";
import { applyCountyEnrichment } from "@/lib/enrichment/apply-county-enrichment";

async function main() {
  const supabase = createServiceSupabase();

  const { data: properties, error } = await supabase.from("properties").select("id, address");
  if (error) throw new Error(`Failed to load properties: ${error.message}`);

  const { data: alreadyDone, error: enrichError } = await supabase.from("enrichments").select("property_id").not("flood_zone", "is", null);
  if (enrichError) throw new Error(`Failed to load existing enrichments: ${enrichError.message}`);
  const doneIds = new Set((alreadyDone ?? []).map((r) => r.property_id));

  const todo = (properties ?? []).filter((p) => !doneIds.has(p.id));
  console.log(`${properties?.length ?? 0} properties total, ${doneIds.size} already have flood_zone, ${todo.length} to process.`);

  let matched = 0;
  let noMatch = 0;
  let failed = 0;
  for (const property of todo) {
    try {
      const result = await applyCountyEnrichment(property.id);
      if (result.matched) matched += 1;
      else noMatch += 1;
    } catch (err) {
      failed += 1;
      console.warn(`  Failed for ${property.id} (${property.address}): ${(err as Error).message}`);
    }
  }

  console.log(`Done. ${matched} matched (flood zone/coastline attempted), ${noMatch} had no county parcel match, ${failed} failed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
