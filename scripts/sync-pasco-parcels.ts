// One-time (re-runnable) ETL: syncs the Pasco County Property Appraiser's
// official weekly bulk data feed into the local `county_parcels` reference
// table, filtered to single-family-like homes. Same table, same matching
// logic (lib/enrichment/county-parcels.ts), and same downstream enrichment
// (lib/enrichment/apply-county-enrichment.ts) already built for Pinellas —
// this just adds a second county's data into it.
//
// Usage: npx tsx scripts/sync-pasco-parcels.ts
//
// Source: https://pascopa.com/information-and-tools/downloads/ (Real Estate
// section) -> downloads.pascopa.com -> ftp01.pascopa.com/real_estate/ — an
// official, sanctioned bulk export the Property Appraiser publishes weekly,
// not a scrape of the disallowed property-detail search pages.

import { resolve } from "node:path";
import { createServiceSupabase } from "@/lib/supabase/server";
import { downloadPascoTableCsv, parsePascoCsv } from "@/lib/enrichment/pascopa-bulk";
import { SUFFIX_ABBREVIATIONS } from "@/lib/enrichment/county-parcels";

process.loadEnvFile(resolve(import.meta.dirname, "../.env.local"));

interface ParcelRecord {
  strap: string;
  county: string;
  parcel_number?: string;
  site_address?: string;
  city?: string;
  zipcode?: string;
  str_num?: string;
  str_name?: string;
  str_sfx?: string;
  year_built?: number;
  heated_area_sqft?: number;
  gross_area_sqft?: number;
  exterior_walls?: string;
  roof_cover?: string;
  roof_frame?: string;
  impr_dscr?: string;
}

function toInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : undefined;
}

// Same broad substring match used for Pinellas (lib/enrichment/apply-county-enrichment.ts's
// sibling in scripts/sync-pinellas-parcels.ts) — Pasco's Bldg_Use_Desc includes
// "Single Family Residential" and "Single Family Villa/Townhome", both of
// which should count.
function isSingleFamilyLike(useDesc: string | undefined): boolean {
  if (!useDesc) return false;
  const v = useDesc.toLowerCase();
  return v.includes("single family") || v === "sfr";
}

// Pasco's site_addresses.csv spells suffixes out in full ("WAY", "COURT",
// "DRIVE") where Pinellas's PCPAO export already stores the abbreviation
// ("way", "ct", "dr"). lib/enrichment/county-parcels.ts's matching logic
// compares a synced row's str_sfx against an abbreviation derived from the
// property's own street text, so normalize here to the same abbreviation
// vocabulary rather than storing Pasco's full words unmatched forever.
function normalizeSuffix(streetSuffix: string | undefined): string | undefined {
  if (!streetSuffix) return undefined;
  return SUFFIX_ABBREVIATIONS[streetSuffix.toLowerCase()] ?? streetSuffix.toLowerCase();
}

async function main() {
  const parcels = new Map<string, ParcelRecord>();
  const heatedSqftSeen = new Map<string, number>();
  const useDescCounts = new Map<string, number>();

  console.log("1/2: building.csv (filtering to single-family-like use descriptions)...");
  const buildingCsv = await downloadPascoTableCsv("building");
  const buildingRows = parsePascoCsv(buildingCsv);
  for (const row of buildingRows) {
    const useDesc = row.Bldg_Use_Desc ?? "";
    useDescCounts.set(useDesc, (useDescCounts.get(useDesc) ?? 0) + 1);
    if (!isSingleFamilyLike(useDesc) || !row.Parcel_Num) continue;

    // A handful of parcels carry multiple building rows (additions, or a
    // shared parcel for several structures) — keep whichever has the
    // largest heated area as the main dwelling, same tie-break spirit as
    // "last write wins" in the Pinellas sync, but deliberate here since
    // Pasco's duplicates are common enough to matter (~780 parcels).
    const heatedSqft = toInt(row.Bldg_Heated_Sqft) ?? 0;
    const previousSqft = heatedSqftSeen.get(row.Parcel_Num) ?? -1;
    if (heatedSqft <= previousSqft) continue;
    heatedSqftSeen.set(row.Parcel_Num, heatedSqft);

    parcels.set(row.Parcel_Num, {
      strap: `PASCO-${row.Parcel_Num}`,
      county: "Pasco",
      parcel_number: row.Parcel_Num,
      impr_dscr: useDesc,
      year_built: toInt(row.Bldg_ActYrBlt),
      heated_area_sqft: heatedSqft || undefined,
      gross_area_sqft: toInt(row.Bldg_Total_Sqft),
      exterior_walls: row.Bldg_ExtWall_1_Desc || undefined,
      roof_cover: row.Bldg_Roof_Cover_Desc || undefined,
      roof_frame: row.Bldg_Roof_Structure_Desc || undefined,
    });
  }
  console.log(`  scanned ${buildingRows.length.toLocaleString()} rows, kept ${parcels.size.toLocaleString()} single-family-like parcels`);
  console.log("  distinct Bldg_Use_Desc values (top 15 by row count):");
  const sortedUseDescCounts = Array.from(useDescCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 15);
  for (const [value, count] of sortedUseDescCounts) {
    console.log(`    ${isSingleFamilyLike(value) ? "[KEPT]" : "[skip]"} "${value}": ${count.toLocaleString()}`);
  }

  console.log("2/2: site_addresses.csv...");
  const addressCsv = await downloadPascoTableCsv("site_addresses");
  const addressRows = parsePascoCsv(addressCsv);
  let addressMatches = 0;
  for (const row of addressRows) {
    const parcelKey = row.PARCEL;
    if (!parcelKey) continue;
    const parcel = parcels.get(parcelKey);
    if (!parcel) continue;
    const streetSuffix = normalizeSuffix(row.STREET_SUFFIX);
    parcel.str_num = row.ADDRESS_NUMBER || undefined;
    parcel.str_name = row.STREET_NAME || undefined;
    parcel.str_sfx = streetSuffix;
    parcel.city = row.CITY || undefined;
    parcel.zipcode = row.ZIP_CODE || undefined;
    parcel.site_address = [row.ADDRESS_NUMBER, row.STREET_NAME, row.STREET_SUFFIX].filter(Boolean).join(" ") || undefined;
    addressMatches += 1;
  }
  console.log(`  scanned ${addressRows.length.toLocaleString()} rows, matched addresses for ${addressMatches.toLocaleString()} parcels`);

  console.log(`Upserting ${parcels.size.toLocaleString()} parcels into county_parcels...`);
  const supabase = createServiceSupabase();
  const rows = Array.from(parcels.values());
  const CHUNK_SIZE = 1000;
  let upserted = 0;
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    const { error } = await supabase.from("county_parcels").upsert(chunk, { onConflict: "strap" });
    if (error) throw new Error(`Upsert failed at row ${i}: ${error.message}`);
    upserted += chunk.length;
    if (upserted % 20_000 < CHUNK_SIZE) console.log(`  ...${upserted.toLocaleString()} upserted`);
  }

  console.log(`Done. ${upserted.toLocaleString()} Pasco single-family-like parcels synced.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
