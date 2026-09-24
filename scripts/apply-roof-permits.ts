// Applies synced roof-permit history (county_roof_permits) to existing
// properties, replacing blank/flat-default roof_year values with the year of
// the most recent qualifying roof permit. Run after
// scripts/sync-pinellas-permits.ts. Never lowers a newer roof year that was
// set from a better source.
//
// Usage: npx tsx scripts/apply-roof-permits.ts [--dry-run]

import { resolve } from "node:path";
process.loadEnvFile(resolve(import.meta.dirname, "../.env.local"));
import { createServiceSupabase } from "@/lib/supabase/server";
import { resolveRoofYearFromPermit } from "@/lib/enrichment/roof-permits";

const NON_BDRS_DEFAULT_ROOF_AGE_YEARS = 10;

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const supabase = createServiceSupabase();
  const placeholderDefaultYear = new Date().getFullYear() - NON_BDRS_DEFAULT_ROOF_AGE_YEARS;

  const { data: properties, error } = await supabase
    .from("properties")
    .select("id, address, parcel_id, roof_year")
    .not("parcel_id", "is", null);
  if (error) throw error;

  let matched = 0;
  let changed = 0;
  for (const property of properties ?? []) {
    const { data: permit, error: permitError } = await supabase
      .from("county_roof_permits")
      .select("roof_year, agency_name, permit_number")
      .eq("parcel_number", property.parcel_id!)
      .maybeSingle();
    if (permitError) throw permitError;
    if (!permit) continue;
    matched += 1;

    const next = resolveRoofYearFromPermit(property.roof_year, permit.roof_year, placeholderDefaultYear);
    if (next === property.roof_year) continue;
    changed += 1;
    console.log(
      `${property.address}: roof_year ${property.roof_year ?? "null"} -> ${next} (${permit.agency_name} ${permit.permit_number})`
    );
    if (!dryRun) {
      const { error: updateError } = await supabase.from("properties").update({ roof_year: next }).eq("id", property.id);
      if (updateError) throw updateError;
    }
  }
  console.log(
    `${dryRun ? "[dry run] " : ""}${matched} of ${properties?.length ?? 0} properties have a roof permit on record; ${changed} ${dryRun ? "would change" : "updated"}.`
  );
}
main().catch((e) => { console.error(e); process.exit(1); });
