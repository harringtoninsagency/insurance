// One-time (re-runnable) ETL: syncs the Hernando County Property Appraiser's
// official bulk CAMA export into the local `county_parcels` reference table,
// filtered to single-family-like homes. Same table, same matching logic
// (lib/enrichment/county-parcels.ts), and same downstream enrichment
// (lib/enrichment/apply-county-enrichment.ts) already built for Pinellas and
// Pasco — this just adds a third county's data into it.
//
// Usage: npx tsx scripts/sync-hernando-parcels.ts
//
// Source: https://hernandocountypa-florida.us/Downloads ("Comprehensive CAMA
// Dataset" section) — a free, self-serve, official bulk export, not a scrape
// of any disallowed search page.
//
// Three tables, joined by the office's own internal "Parcel Key" (not the
// human-readable Parcel Number, which only PAPAR carries):
//   PAPAR  — one row per parcel: Parcel Number (our `parcel_number`), DOR
//            use code (01 = Single Family — confirmed against real data,
//            74,272 of 122,366 parcels), and a parcel-level total square
//            footage field that was verified against real rows to exactly
//            equal a parcel's STRU base+aux area sum, so it's used directly
//            as `gross_area_sqft` rather than re-summed from STRU.
//   STRU   — one row per structure on a parcel (main house, plus any
//            garage/barn/shed as separate rows). A parcel's main dwelling is
//            picked as whichever STRU row has the largest "Base Area Size"
//            — same tie-break as scripts/sync-pasco-parcels.ts, and verified
//            against real data to reliably select "SINGLE FAMILY RESIDENCE"
//            over accessory structures. Also carries 12 generic "Structural
//            Element" slots; per the office's own STRUCTURE_ELEMENTS.PDF
//            code table (cross-checked against real rows), these are fixed
//            by position, not free-form: slot 2 = exterior wall, slot 6 =
//            roof structure, slot 7 = roof cover.
//   LOCA   — situs address, already split into number/name/type/direction
//            (unlike PAPAR's own "Location Street Name", which mashes name
//            and suffix into one field) — covers 74,232 of the 74,272
//            single-family parcels (99.9%); PAPAR's combined field is the
//            fallback for the rest, with the suffix split off the same way
//            lib/enrichment/pascopa-bulk.ts's caller does for Pasco.
//
// Neither table carries a situs city or zip (confirmed against both record
// layouts) — left null, same as any other field this office doesn't supply.
// `county_parcels.zipcode` is only ever a tiebreaker in the matching logic
// (lib/enrichment/county-parcels.ts), never required, so this is survivable.

import { loadEnvIfPresent } from "@/lib/env";
loadEnvIfPresent();

import { createServiceSupabase } from "@/lib/supabase/server";
import { downloadHernandoTableText, fixedField, parseFixedWidthLines } from "@/lib/enrichment/hernandopa-bulk";
import { SUFFIX_ABBREVIATIONS } from "@/lib/enrichment/county-parcels";

const SINGLE_FAMILY_DOR_CODE = "01";

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

function toInt(value: string): number | undefined {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

// PAPAR's "Location Street Name" has no separate suffix field (unlike LOCA)
// — e.g. "FRIENDLY RD" or "SPRING PRAIRIE RD" — so split the last word off
// as the suffix when it's a recognized one, same vocabulary normalizeStreetName
// already uses for matching.
function splitCombinedStreetName(combined: string): { name: string; sfx?: string } {
  const words = combined.trim().split(/\s+/);
  const last = words[words.length - 1]?.toLowerCase();
  if (words.length > 1 && last && SUFFIX_ABBREVIATIONS[last]) {
    return { name: words.slice(0, -1).join(" "), sfx: SUFFIX_ABBREVIATIONS[last] };
  }
  return { name: combined };
}

async function main() {
  console.log("1/3: PAPAR.ZIP (filtering to DOR code 01, Single Family)...");
  const paparText = await downloadHernandoTableText("PAPAR");
  const paparLines = parseFixedWidthLines(paparText);

  const parcels = new Map<string, ParcelRecord & { parcelKey: string }>();
  const dorCounts = new Map<string, number>();
  for (const line of paparLines) {
    const dorCode = fixedField(line, 253, 254);
    dorCounts.set(dorCode, (dorCounts.get(dorCode) ?? 0) + 1);
    if (dorCode !== SINGLE_FAMILY_DOR_CODE) continue;

    const parcelKey = fixedField(line, 10, 17);
    const parcelNumber = fixedField(line, 26, 50);
    if (!parcelKey || !parcelNumber) continue;

    const locationNumber = fixedField(line, 71, 75);
    const combinedStreet = fixedField(line, 76, 100);
    const { name, sfx } = combinedStreet ? splitCombinedStreetName(combinedStreet) : { name: undefined, sfx: undefined };
    const grossSqft = toInt(fixedField(line, 444, 451));

    parcels.set(parcelKey, {
      parcelKey,
      strap: `HERNANDO-${parcelKey}`,
      county: "Hernando",
      parcel_number: parcelNumber,
      str_num: locationNumber || undefined,
      str_name: name,
      str_sfx: sfx,
      site_address: [locationNumber, combinedStreet].filter(Boolean).join(" ") || undefined,
      gross_area_sqft: grossSqft,
      impr_dscr: "Single Family (DOR 01)",
    });
  }
  console.log(`  scanned ${paparLines.length.toLocaleString()} rows, kept ${parcels.size.toLocaleString()} single-family parcels`);
  console.log("  DOR code distribution (top 15):");
  [...dorCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .forEach(([code, count]) => {
      console.log(`    ${code === SINGLE_FAMILY_DOR_CODE ? "[KEPT]" : "[skip]"} "${code}": ${count.toLocaleString()}`);
    });

  console.log("2/3: STRU.ZIP (picking the largest-heated-area structure per parcel)...");
  const struText = await downloadHernandoTableText("STRU");
  const struLines = parseFixedWidthLines(struText);
  const bestHeatedSeen = new Map<string, number>();
  let struMatches = 0;
  for (const line of struLines) {
    const parcelKey = fixedField(line, 1, 8);
    const parcel = parcels.get(parcelKey);
    if (!parcel) continue;

    const heatedSqft = toInt(fixedField(line, 655, 661)) ?? 0;
    const previousBest = bestHeatedSeen.get(parcelKey) ?? -1;
    if (heatedSqft <= previousBest) continue;
    bestHeatedSeen.set(parcelKey, heatedSqft);

    // 12 generic 12-char slots starting at position 504, one per Structural
    // Element group (1-indexed); group 2 = exterior wall, group 6 = roof
    // structure, group 7 = roof cover (see header comment).
    const structuralElement = (group: number) => fixedField(line, 504 + (group - 1) * 12, 515 + (group - 1) * 12) || undefined;

    parcel.heated_area_sqft = heatedSqft || undefined;
    parcel.year_built = toInt(fixedField(line, 52, 55));
    parcel.exterior_walls = structuralElement(2);
    parcel.roof_frame = structuralElement(6);
    parcel.roof_cover = structuralElement(7);
    struMatches += 1;
  }
  console.log(`  scanned ${struLines.length.toLocaleString()} rows, matched structures for ${struMatches.toLocaleString()} parcels`);

  console.log("3/3: LOCA.ZIP (situs address, overriding PAPAR's combined field when present)...");
  const locaText = await downloadHernandoTableText("LOCA");
  const locaLines = parseFixedWidthLines(locaText);
  let locaMatches = 0;
  for (const line of locaLines) {
    const parcelKey = fixedField(line, 1, 8);
    const parcel = parcels.get(parcelKey);
    if (!parcel) continue;

    const addrNum = fixedField(line, 9, 14);
    const streetName = fixedField(line, 17, 41);
    const streetType = fixedField(line, 42, 45);
    if (!streetName) continue;

    parcel.str_num = addrNum.replace(/^0+(?=\d)/, "") || parcel.str_num;
    // Stored raw (not run through normalizeStreetName), same as Pinellas/Pasco
    // — the matching logic in lib/enrichment/county-parcels.ts normalizes the
    // incoming property address at lookup time and compares it against this
    // raw value directly.
    parcel.str_name = streetName;
    parcel.str_sfx = streetType ? (SUFFIX_ABBREVIATIONS[streetType.toLowerCase()] ?? streetType.toLowerCase()) : parcel.str_sfx;
    parcel.site_address = [addrNum.replace(/^0+(?=\d)/, ""), streetName, streetType].filter(Boolean).join(" ");
    locaMatches += 1;
  }
  console.log(`  scanned ${locaLines.length.toLocaleString()} rows, matched addresses for ${locaMatches.toLocaleString()} parcels`);

  const rows: ParcelRecord[] = Array.from(parcels.values()).map(({ parcelKey, ...rest }) => rest);
  console.log(`Upserting ${rows.length.toLocaleString()} parcels into county_parcels...`);
  const supabase = createServiceSupabase();
  const CHUNK_SIZE = 1000;
  let upserted = 0;
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    const { error } = await supabase.from("county_parcels").upsert(chunk, { onConflict: "strap" });
    if (error) throw new Error(`Upsert failed at row ${i}: ${error.message}`);
    upserted += chunk.length;
    if (upserted % 20_000 < CHUNK_SIZE) console.log(`  ...${upserted.toLocaleString()} upserted`);
  }

  console.log(`Done. ${upserted.toLocaleString()} Hernando single-family parcels synced.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
