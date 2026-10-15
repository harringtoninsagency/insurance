// One-time (re-runnable) ETL: syncs Florida's statewide parcel + NAL dataset
// (lib/enrichment/fdor-statewide-bulk.ts) into `county_parcels`, filtered to
// residential DOR use codes, for every Florida county EXCEPT Pinellas (62)
// — Pinellas already has a richer, locally-sourced dataset (roof/wall
// materials, 85%+ coordinate coverage; see scripts/sync-pinellas-parcels.ts)
// that this statewide, NAL-only source can't match (no roof/wall/floor
// fields in the state's data — just DOR use code, year built, living area,
// owner, and situs address). Pasco (61) and Hernando (37) ARE included:
// their own per-county syncs only ever covered single-family (DOR_UC 001),
// so this fills in their other residential types (mobile homes, condos,
// multi-family, co-ops) the same way scripts/sync-pinellas-parcels.ts did
// for Pinellas directly from PCPAO — under a different strap prefix
// (`FL-<county>-<parcel id>` vs `PASCO-`/`HERNANDO-`), so nothing collides
// or overwrites the richer single-family rows already there.
//
// Usage: npx tsx scripts/sync-fdor-statewide-parcels.ts [--start-county=N]
//
// Source: https://services9.arcgis.com/Gh9awoU677aKree0/arcgis/rest/services/Florida_Statewide_Cadastral/FeatureServer/0
// — the Florida Geographic Information Office's public "Florida Statewide
// Parcels" layer, built from the Dept. of Revenue's own annual NAL
// submissions from all 67 counties. No login needed (verified with a direct
// curl: the Dept. of Revenue's own document-library download page 401s,
// this ArcGIS layer doesn't).
//
// This is a genuinely large pull — 66 counties, Hillsborough alone is
// ~449,200 residential parcels — likely several million rows and multiple
// hours. Logs progress per county/code pair and continues past an
// individual county/code failure rather than aborting the whole run (a
// multi-hour job shouldn't lose everything to one transient error), with a
// final summary of anything that failed to retry by hand.

import { loadEnvIfPresent } from "@/lib/env";
loadEnvIfPresent();

import { createServiceSupabase } from "@/lib/supabase/server";
import { countFdorParcels, fetchFdorParcels, type FdorParcelAttributes } from "@/lib/enrichment/fdor-statewide-bulk";
import { SUFFIX_ABBREVIATIONS, normalizeStreetName } from "@/lib/enrichment/county-parcels";

// Residential DOR use codes only (Florida's statewide standard — same
// scheme used by every county, confirmed against Hernando's own PAPAR DOR
// codes). 000 (vacant residential) is deliberately excluded: no structure
// yet to insure, same reasoning as every other sync script here.
const RESIDENTIAL_DOR_CODES: { code: string; label: string }[] = [
  { code: "001", label: "Single Family" },
  { code: "002", label: "Mobile Home" },
  { code: "003", label: "Multi-Family (<10 units)" },
  { code: "004", label: "Condominium" },
  { code: "005", label: "Cooperative" },
];

const PINELLAS_CO_NO = 62;
const ALL_COUNTY_NUMBERS = Array.from({ length: 67 }, (_, i) => i + 11); // 11..77, confirmed via returnDistinctValues against the live service

// Optional resume point: npx tsx scripts/sync-fdor-statewide-parcels.ts --start-county=39
// This run is slow enough (network retries under load; observed several
// counties per hour, not per minute) that it has repeatedly outlived a
// single session and needed restarting — without this, every restart redid
// every earlier county from scratch even though the upserts already landed
// (idempotent, but wasted real time re-fetching and re-upserting the same
// rows). Pick the start county from the highest CO_NO already present in
// county_parcels (select distinct on strap's FL-<n>- prefix) rather than
// trusting a log tail, which can lag or be missing if a prior run died
// before flushing.
const startCountyArg = process.argv.find((a) => a.startsWith("--start-county="));
const startCounty = startCountyArg ? Number.parseInt(startCountyArg.split("=")[1]!, 10) : ALL_COUNTY_NUMBERS[0]!;
const COUNTY_NUMBERS = ALL_COUNTY_NUMBERS.filter((n) => n !== PINELLAS_CO_NO && n >= startCounty);

// Only the handful confirmed by directly querying the service for a
// landmark county-seat/distinctive city (e.g. CO_NO=39 -> "TAMPA" ==
// Hillsborough). This is a label only — never used for matching or lookup
// (that's strap/address-based) — so the rest fall back to a generic
// "Florida County #<n>" rather than guessing from an ambiguous border-town
// PHY_CITY sample (e.g. "OKEECHOBEE" showed up under three different county
// numbers, since a postal city can straddle a county line).
const KNOWN_COUNTY_NAMES: Record<number, string> = {
  11: "Alachua",
  29: "Franklin",
  36: "Hendry",
  37: "Hernando",
  38: "Highlands",
  39: "Hillsborough",
  42: "Jackson",
  43: "Jefferson",
  44: "Lafayette",
  45: "Lake",
  47: "Leon",
  49: "Liberty",
  50: "Madison",
  51: "Manatee",
  54: "Monroe",
  58: "Orange",
  59: "Osceola",
  61: "Pasco",
  63: "Polk",
  67: "Santa Rosa",
};

function countyName(countyNo: number): string {
  return KNOWN_COUNTY_NAMES[countyNo] ?? `Florida County #${countyNo}`;
}

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
  impr_dscr?: string;
}

// PHY_ADDR1 is one combined field like "2601 NE 160TH LN" — house number,
// an optional leading directional, the bare street name, and a suffix all
// run together (unlike Hernando's PAPAR, which at least kept the house
// number separate). Splits off the house number first, then reuses the same
// suffix vocabulary and normalizeStreetName (which strips a leading/trailing
// directional) the matching logic itself uses, so str_name ends up bare —
// the same contract every other county's sync already follows.
//
// Condo units append a bare trailing unit number with no "APT"/"#" marker
// at all (e.g. "208 DANUBE AVE 101", confirmed against real Hillsborough
// condo rows) — stripUnitDesignator in lib/enrichment/county-parcels.ts only
// catches a marked unit ("#1", "Unit 2"), so a trailing all-digits word is
// dropped here before suffix detection, or it would swallow the real suffix
// and corrupt str_name for every condo in the state.
function parsePhyAddr1(addr1: string): { strNum?: string; strName?: string; strSfx?: string } {
  const words = addr1.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return {};

  let strNum: string | undefined;
  let rest = words;
  if (/^\d+$/.test(words[0]!)) {
    strNum = words[0];
    rest = words.slice(1);
  }
  if (rest.length > 1 && /^\d+$/.test(rest[rest.length - 1]!)) {
    rest = rest.slice(0, -1);
  }
  if (rest.length === 0) return { strNum };

  let strSfx: string | undefined;
  const lastWord = rest[rest.length - 1]!.toLowerCase();
  if (rest.length > 1 && SUFFIX_ABBREVIATIONS[lastWord]) {
    strSfx = SUFFIX_ABBREVIATIONS[lastWord];
    rest = rest.slice(0, -1);
  }

  const remaining = rest.join(" ");
  const strName = remaining ? normalizeStreetName(remaining).toUpperCase() : undefined;
  return { strNum, strName, strSfx };
}

function toParcelRecord(row: FdorParcelAttributes, dorLabel: string): ParcelRecord | null {
  if (!row.PARCEL_ID?.trim()) return null;

  const addr1 = row.PHY_ADDR1?.trim();
  const parsed = addr1 ? parsePhyAddr1(addr1) : {};
  const siteAddress = [row.PHY_ADDR1, row.PHY_ADDR2, row.PHY_CITY].filter((s) => s?.trim()).join(", ") || undefined;

  return {
    strap: `FL-${row.CO_NO}-${row.PARCEL_ID.trim()}`,
    county: countyName(row.CO_NO),
    parcel_number: row.PARCEL_ID.trim(),
    site_address: siteAddress,
    city: row.PHY_CITY?.trim() || undefined,
    zipcode: row.PHY_ZIPCD ? String(row.PHY_ZIPCD) : undefined,
    str_num: parsed.strNum,
    str_name: parsed.strName,
    str_sfx: parsed.strSfx,
    year_built: row.ACT_YR_BLT && row.ACT_YR_BLT > 0 ? row.ACT_YR_BLT : undefined,
    heated_area_sqft: row.TOT_LVG_AR && row.TOT_LVG_AR > 0 ? Math.round(row.TOT_LVG_AR) : undefined,
    impr_dscr: dorLabel,
  };
}

// A single parcel can carry more than one feature row in this layer (e.g.
// non-contiguous pieces of the same tax parcel each get their own polygon),
// so two rows with the same PARCEL_ID — and therefore the same `strap` — can
// land in one page. Postgres's ON CONFLICT rejects a batch that targets the
// same conflict key twice in one statement ("command cannot affect row a
// second time"), confirmed by hitting exactly that error on the very first
// county. Deduping per chunk (last one wins) is enough — repeating the same
// key across two separate upsert() calls is fine, only one call at a time
// matters.
function dedupeByStrap(rows: ParcelRecord[]): ParcelRecord[] {
  const byStrap = new Map<string, ParcelRecord>();
  for (const row of rows) byStrap.set(row.strap, row);
  return Array.from(byStrap.values());
}

// Same watchdog pattern as fetchJsonWithRetry in lib/enrichment/fdor-statewide-bulk.ts
// (see its comment for why): this call goes through the same sandboxed
// proxy as the FDOR fetches, so it's exposed to the same risk of silently
// never settling. Races it against an independent timer rather than
// trusting the Supabase client call to reject on its own.
async function upsertOneChunk(supabase: ReturnType<typeof createServiceSupabase>, chunk: ParcelRecord[], attempt = 1): Promise<void> {
  try {
    const result = await Promise.race([
      supabase.from("county_parcels").upsert(chunk, { onConflict: "strap" }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("watchdog: upsert did not settle within 60s")), 60_000)),
    ]);
    if (result.error) throw new Error(`Upsert failed: ${result.error.message}`);
  } catch (err) {
    if (attempt >= 5) throw err;
    const delayMs = 2000 * attempt;
    await new Promise((r) => setTimeout(r, delayMs));
    return upsertOneChunk(supabase, chunk, attempt + 1);
  }
}

async function upsertChunked(supabase: ReturnType<typeof createServiceSupabase>, rows: ParcelRecord[]): Promise<void> {
  const CHUNK_SIZE = 1000;
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = dedupeByStrap(rows.slice(i, i + CHUNK_SIZE));
    await upsertOneChunk(supabase, chunk);
  }
}

async function main() {
  const supabase = createServiceSupabase();
  const startedAt = Date.now();
  let totalSynced = 0;
  const failures: string[] = [];

  console.log(`Syncing ${COUNTY_NUMBERS.length} counties x ${RESIDENTIAL_DOR_CODES.length} residential DOR codes...`);

  for (const countyNo of COUNTY_NUMBERS) {
    for (const { code, label } of RESIDENTIAL_DOR_CODES) {
      const tag = `${countyName(countyNo)} (#${countyNo}) / ${label}`;
      try {
        const expectedCount = await countFdorParcels(countyNo, code);
        if (expectedCount === 0) continue;

        // No sub-county resume (--start-county only skips whole counties),
        // so a container restart mid-pair used to mean every relaunch
        // re-fetched this exact county/code pair from page 1 — on a large
        // county (Orange County alone is 200k+ Single Family parcels) that
        // can outlive one relaunch window, repeatedly losing to the same
        // restart before finishing. Skip a pair that's already at/near its
        // expected count instead: 98% covers the sliver that can
        // legitimately differ between the count call and the fetch (new
        // parcels recorded in between). Same fix as _retry-fdor-pairs.ts.
        const { count: existingCount } = await supabase
          .from("county_parcels")
          .select("strap", { count: "exact", head: true })
          .eq("impr_dscr", label)
          .like("strap", `FL-${countyNo}-%`);
        if (existingCount !== null && existingCount >= expectedCount * 0.98) {
          console.log(`  ${tag}: already has ${existingCount.toLocaleString()} / ${expectedCount.toLocaleString()} expected, skipping`);
          totalSynced += existingCount;
          continue;
        }

        let countySynced = 0;
        for await (const page of fetchFdorParcels(countyNo, code)) {
          const records = page.map((row) => toParcelRecord(row, label)).filter((r): r is ParcelRecord => r !== null);
          if (records.length > 0) await upsertChunked(supabase, records);
          countySynced += records.length;
        }
        totalSynced += countySynced;
        console.log(`  ${tag}: ${countySynced.toLocaleString()} / ${expectedCount.toLocaleString()} expected`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`  FAILED ${tag}: ${message}`);
        failures.push(tag);
      }
    }
  }

  const minutes = ((Date.now() - startedAt) / 60_000).toFixed(1);
  console.log(`\nDone in ${minutes} minutes. ${totalSynced.toLocaleString()} statewide parcels synced.`);
  if (failures.length > 0) {
    console.log(`${failures.length} county/code pairs failed and were skipped (re-run this script to retry — it's idempotent):`);
    failures.forEach((f) => console.log(`  - ${f}`));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
