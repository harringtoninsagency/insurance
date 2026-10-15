// One-time (re-runnable) ETL: syncs Pinellas County Property Appraiser's
// official Raw Database Files bulk export into the local `county_parcels`
// reference table, filtered to residential dwelling types (single-family,
// condo, townhouse, villa, manufactured home, duplex-to-4-plex) — see
// isResidentialLike below for the exact list and why each is included.
//
// Usage: npx tsx scripts/sync-pinellas-parcels.ts
//
// This downloads three multi-hundred-MB-to-1.3GB JSON files and stream-parses
// them — it takes several minutes and must never run inside a Next.js
// request/serverless function. PCPAO's /property-details page is disallowed
// in robots.txt, but this bulk-download feature is an official, sanctioned
// export (see https://www.pcpao.gov/tools-data/data-downloads/raw-database-files),
// not the disallowed path.

import { loadEnvIfPresent } from "@/lib/env";
loadEnvIfPresent();

import { createServiceSupabase } from "@/lib/supabase/server";
import { downloadTableJsonStream, streamEachRecord } from "@/lib/enrichment/pcpao-bulk";

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

// Originally single-family-only; broadened to individually-owned residential
// dwelling types a homeowner (not a commercial landlord) would carry their
// own insurance on. Verified against a real, fresh pull of every distinct
// IMPR_DSCR value and its row count (428,285 total rows) rather than
// guessed — the full top-50 list is logged below on every run so a future
// change here can be checked the same way.
//
// Included, beyond single-family:
//   Townhouse, Villa, Manufactured Homes, Duplex - 4-Plex, Modular,
//   Unique Residential, Res Conversions — individually-deeded residential
//   dwelling types.
//   Garden - No Elevator / Garden - Elevator / Mid Rise 4-11 Fl /
//   High Rise >11 Fl / Garden Apartments / Apartments (High-Rise) — despite
//   the "Apartments" wording, Florida county CAMA systems use these labels
//   for the condo BUILDING's architectural style, not rental-apartment
//   ownership; the row counts (e.g. 36,190 "Garden - No Elevator") are far
//   too high to be whole apartment complexes (Pinellas has nowhere near that
//   many) and line up with one row per individually-owned condo unit.
// Deliberately excluded: "Res Comm Use" (ambiguous residential/commercial
// blend) and every clearly commercial/industrial/institutional category
// (offices, warehouses, retail, hotels, churches, hospitals, etc.).
const RESIDENTIAL_IMPR_DSCR = new Set(
  [
    "Single Family",
    "SFR",
    "Townhouse",
    "Villa",
    "Manufactured Homes",
    "Duplex - 4-Plex",
    "Modular",
    "Unique Residential",
    "Res Conversions",
    "Garden - No Elevator",
    "Garden - Elevator",
    "Mid Rise 4-11 Fl",
    "High Rise >11 Fl",
    "Garden Apartments",
    "Apartments (High-Rise)",
  ].map((s) => s.toLowerCase())
);

function isResidentialLike(imprDscr: string | undefined): boolean {
  if (!imprDscr) return false;
  return RESIDENTIAL_IMPR_DSCR.has(imprDscr.toLowerCase());
}

async function main() {
  const parcels = new Map<string, ParcelRecord>();
  const imprDscrCounts = new Map<string, number>();

  console.log("Pass 1/3: RP_BUILDING (filtering to residential dwelling-type descriptions)...");
  const buildingStream = await downloadTableJsonStream("RP_BUILDING");
  const buildingCount = await streamEachRecord(buildingStream, (row) => {
    const dscr = row.IMPR_DSCR ?? "";
    imprDscrCounts.set(dscr, (imprDscrCounts.get(dscr) ?? 0) + 1);
    if (!isResidentialLike(dscr) || !row.STRAP) return;
    parcels.set(row.STRAP, {
      strap: row.STRAP,
      county: "Pinellas",
      impr_dscr: row.IMPR_DSCR,
      year_built: toInt(row.YEAR_BUILT),
      heated_area_sqft: toInt(row.HEATED_AREA_SQFT),
      gross_area_sqft: toInt(row.GROSS_AREA_SQFT),
      exterior_walls: row.EXTERIOR_WALLS || undefined,
    });
  });
  console.log(`  scanned ${buildingCount.toLocaleString()} rows, kept ${parcels.size.toLocaleString()} residential parcels`);
  console.log("  distinct IMPR_DSCR values (top 30 by row count):");
  const sortedDscrCounts = Array.from(imprDscrCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 30);
  for (const [value, count] of sortedDscrCounts) {
    console.log(`    ${isResidentialLike(value) ? "[KEPT]" : "[skip]"} "${value}": ${count.toLocaleString()}`);
  }

  console.log("Pass 2/3: RP_ALL_SITE_ADDRESSES...");
  const addressStream = await downloadTableJsonStream("RP_ALL_SITE_ADDRESSES");
  const addressCount = await streamEachRecord(addressStream, (row) => {
    if (!row.STRAP) return;
    const parcel = parcels.get(row.STRAP);
    if (!parcel) return;
    parcel.parcel_number = row.PARCEL_NUMBER || undefined;
    parcel.site_address = row.SITE_ADDR || undefined;
    parcel.city = row.CITY || undefined;
    parcel.zipcode = row.ZIP || undefined;
    parcel.str_num = row.STR_NUM || undefined;
    parcel.str_name = row.STR_NAME || undefined;
    parcel.str_sfx = row.STR_SFX || undefined;
  });
  console.log(`  scanned ${addressCount.toLocaleString()} rows`);

  console.log("Pass 3/3: RP_STRUCTURAL_ELEMENTS (roof cover/frame)...");
  const structuralStream = await downloadTableJsonStream("RP_STRUCTURAL_ELEMENTS");
  const structuralCount = await streamEachRecord(structuralStream, (row) => {
    if ((row.ATTRIBUTE_CD !== "RFC" && row.ATTRIBUTE_CD !== "RFF") || !row.STRAP) return;
    const parcel = parcels.get(row.STRAP);
    if (!parcel) return;
    if (row.ATTRIBUTE_CD === "RFC") parcel.roof_cover = row.ATTRIBUTE_VALUE || undefined;
    if (row.ATTRIBUTE_CD === "RFF") parcel.roof_frame = row.ATTRIBUTE_VALUE || undefined;
  });
  console.log(`  scanned ${structuralCount.toLocaleString()} rows`);

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

  console.log(`Done. ${upserted.toLocaleString()} Pinellas residential parcels synced.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
