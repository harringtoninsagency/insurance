// Re-runnable job: for every quote-request property that has no photo or
// only the NAIP aerial fallback, looks for an ingested OneHome listing at the
// same address and copies its MLS front photo over
// (lib/proposals/onehome-photo-match.ts). New quote requests get this inline
// in prepareQuoteRequest; this catches the ones created before that existed,
// and anything listed on OneHome *after* its quote request came in.
//
// Usage: npx tsx scripts/backfill-onehome-photos.ts [--dry-run]

import { loadEnvIfPresent } from "@/lib/env";
loadEnvIfPresent();
import { createServiceSupabase } from "@/lib/supabase/server";
import { normalizeStreetName } from "@/lib/enrichment/county-parcels";
import { attachOneHomePhotoIfListed } from "@/lib/proposals/onehome-photo-match";

const dryRun = process.argv.includes("--dry-run");
const supabase = createServiceSupabase();

const { data: targets, error } = await supabase
  .from("properties")
  .select("id, agency_id, address, house_number, street, city, zipcode, photo_source")
  .eq("source", "quote_request")
  .or("photo_path.is.null,photo_source.eq.naip_aerial")
  .order("created_at", { ascending: false });
if (error) throw new Error(error.message);

const { data: listed } = await supabase
  .from("properties")
  .select("agency_id, house_number, street, city, zipcode")
  .eq("source", "onehome")
  .eq("photo_source", "onehome")
  .not("photo_path", "is", null);

const listedKeys = new Set(
  (listed ?? [])
    .filter((l) => l.house_number && l.street)
    .map((l) => `${l.agency_id}|${l.house_number!.toLowerCase()}|${normalizeStreetName(l.street!)}|${(l.zipcode ?? "").slice(0, 5) || (l.city ?? "").toLowerCase()}`)
);

let attached = 0;
let noMatch = 0;
let skipped = 0;
for (const p of targets ?? []) {
  if (!p.house_number || !p.street) {
    skipped += 1;
    continue;
  }
  const key = `${p.agency_id}|${p.house_number.toLowerCase()}|${normalizeStreetName(p.street)}|${(p.zipcode ?? "").slice(0, 5) || (p.city ?? "").toLowerCase()}`;
  if (!listedKeys.has(key)) {
    noMatch += 1;
    continue;
  }
  if (dryRun) {
    console.log(`would attach: ${p.address} (currently ${p.photo_source ?? "no photo"})`);
    attached += 1;
    continue;
  }
  const result = await attachOneHomePhotoIfListed(p.id);
  if (result.status === "attached") {
    attached += 1;
    console.log(`attached: ${p.address} (replaced ${result.replaced})`);
  } else {
    skipped += 1;
    console.log(`${result.status}: ${p.address}${"reason" in result ? ` — ${result.reason}` : ""}`);
  }
}

console.log(JSON.stringify({ dryRun, candidates: targets?.length ?? 0, attached, noMatch, skipped }));
