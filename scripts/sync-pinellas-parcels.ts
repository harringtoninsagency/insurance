// One-time (re-runnable) ETL: syncs Pinellas County Property Appraiser's
// official Raw Database Files bulk export into the local `county_parcels`
// reference table, filtered to single-family homes.
//
// Usage: npx tsx scripts/sync-pinellas-parcels.ts
//
// This downloads three multi-hundred-MB-to-1.3GB JSON files and stream-parses
// them — it takes several minutes and must never run inside a Next.js
// request/serverless function. PCPAO's /property-details page is disallowed
// in robots.txt, but this bulk-download feature is an official, sanctioned
// export (see https://www.pcpao.gov/tools-data/data-downloads/raw-database-files),
// not the disallowed path.

import { resolve } from "node:path";
import { Transform, type Readable } from "node:stream";
import unzipper from "unzipper";
import streamArray from "stream-json/streamers/stream-array.js";
import { createServiceSupabase } from "@/lib/supabase/server";

process.loadEnvFile(resolve(import.meta.dirname, "../.env.local"));

const BASE_URL = "https://www.pcpao.gov";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

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

async function downloadTableJsonStream(tableName: string): Promise<Readable> {
  const res = await fetch(`${BASE_URL}/dal/databasefile/downloadDatabaseFile`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": USER_AGENT,
      Referer: `${BASE_URL}/tools-data/data-downloads/raw-database-files`,
    },
    body: new URLSearchParams({ hdn_tbl_name: tableName, hdn_ftype: "json" }),
  });
  if (!res.ok) {
    throw new Error(`Failed to download ${tableName}: HTTP ${res.status}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  const directory = await unzipper.Open.buffer(buffer);
  const entry = directory.files[0];
  if (!entry) {
    throw new Error(`${tableName}.zip contained no entries`);
  }
  console.log(`Downloaded ${tableName} (${(buffer.length / 1e6).toFixed(1)} MB zipped)`);
  return entry.stream();
}

// PCPAO's JSON export has a trailing comma before the closing `]`, which is
// invalid strict JSON that stream-json's parser rejects. Buffers only the
// last `tailSize` bytes (bounded memory even for a 1.3GB stream) and strips
// a trailing comma from them on flush.
function fixTrailingComma(tailSize = 64): Transform {
  let tail = Buffer.alloc(0);
  return new Transform({
    transform(chunk: Buffer, _enc, callback) {
      const combined = Buffer.concat([tail, chunk]);
      if (combined.length > tailSize) {
        const emitLen = combined.length - tailSize;
        this.push(combined.subarray(0, emitLen));
        tail = Buffer.from(combined.subarray(emitLen));
      } else {
        tail = combined;
      }
      callback();
    },
    flush(callback) {
      this.push(tail.toString("utf8").replace(/,(\s*\])\s*$/, "$1"));
      callback();
    },
  });
}

async function streamEachRecord(
  source: Readable,
  onRecord: (record: Record<string, string>) => void
): Promise<number> {
  let count = 0;
  await new Promise<void>((resolvePromise, reject) => {
    const pipeline = source.pipe(fixTrailingComma()).pipe(streamArray.withParserAsStream());
    pipeline.on("data", ({ value }: { value: Record<string, string> }) => {
      onRecord(value);
      count += 1;
      if (count % 100_000 === 0) console.log(`  ...${count.toLocaleString()} rows`);
    });
    pipeline.on("end", () => resolvePromise());
    pipeline.on("error", reject);
  });
  return count;
}

function toInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : undefined;
}

// An exact `=== "Single Family"` match against IMPR_DSCR excluded a handful
// of confirmed single-family homes that PCPAO records under a related but
// differently-worded description (e.g. "Single Family Res"). Match broadly
// on the substring instead, plus the bare "SFR" acronym some rows use.
function isSingleFamilyLike(imprDscr: string | undefined): boolean {
  if (!imprDscr) return false;
  const v = imprDscr.toLowerCase();
  return v.includes("single family") || v === "sfr";
}

async function main() {
  const parcels = new Map<string, ParcelRecord>();
  const imprDscrCounts = new Map<string, number>();

  console.log("Pass 1/3: RP_BUILDING (filtering to single-family-like descriptions)...");
  const buildingStream = await downloadTableJsonStream("RP_BUILDING");
  const buildingCount = await streamEachRecord(buildingStream, (row) => {
    const dscr = row.IMPR_DSCR ?? "";
    imprDscrCounts.set(dscr, (imprDscrCounts.get(dscr) ?? 0) + 1);
    if (!isSingleFamilyLike(dscr) || !row.STRAP) return;
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
  console.log(`  scanned ${buildingCount.toLocaleString()} rows, kept ${parcels.size.toLocaleString()} single-family-like parcels`);
  console.log("  distinct IMPR_DSCR values (top 30 by row count):");
  const sortedDscrCounts = Array.from(imprDscrCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 30);
  for (const [value, count] of sortedDscrCounts) {
    console.log(`    ${isSingleFamilyLike(value) ? "[KEPT]" : "[skip]"} "${value}": ${count.toLocaleString()}`);
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

  console.log(`Done. ${upserted.toLocaleString()} Pinellas single-family-like parcels synced.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
