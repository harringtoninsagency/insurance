// One-time (re-runnable) ETL: downloads PCPAO's own "Parcel Label Point"
// shapefile (a point at the representational center of each parcel polygon,
// keyed by the same STRAP already in county_parcels — see
// https://www.pcpao.gov/tools-data/maps-gis/shape-files) and backfills
// county_parcels.lat/lon from it. This is PCPAO's official per-parcel GIS
// centroid, not a third-party geocoder — same "use the county's own sanctioned
// data" approach as scripts/sync-pinellas-parcels.ts.
//
// The shapefile ships in NAD83 HARN StatePlane Florida West (feet); reprojected
// to WGS84 (EPSG:4326) with proj4 before storing.
//
// Usage: npx tsx scripts/sync-pinellas-parcel-coordinates.ts

import { loadEnvIfPresent } from "@/lib/env";
loadEnvIfPresent();

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import unzipper from "unzipper";
// Namespace import, not default: this is a plain CJS module with no
// `exports.default` (only named `exports.open` etc.) — tsx's CJS/ESM interop
// resolves a default import of it to `undefined` even with esModuleInterop
// on, while a namespace import reliably captures the whole exports object.
import * as shapefile from "shapefile";
import proj4 from "proj4";
import { createServiceSupabase } from "@/lib/supabase/server";

const SHAPEFILE_URL = "https://www.pcpao.gov/dal/shapefile/downloadParcelLabel";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

// NAD_1983_HARN_StatePlane_Florida_West_FIPS_0902_Feet, read from the
// shapefile's own .prj (equivalent to EPSG:2882). WGS84 vs NAD83 HARN differs
// by at most ~1-2m in Florida — negligible next to a mile-scale coastline
// distance or a point-in-polygon flood zone lookup.
const SOURCE_PROJECTION =
  "+proj=tmerc +lat_0=24.33333333333333 +lon_0=-82 +k=0.9999411764705882 +x_0=200000.0001016 +y_0=0 +datum=NAD83 +units=us-ft +no_defs";

async function downloadAndExtract(dir: string): Promise<string> {
  const res = await fetch(SHAPEFILE_URL, { method: "POST", headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`Failed to download parcel label shapefile: HTTP ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  console.log(`Downloaded ${(buffer.length / 1e6).toFixed(1)} MB zipped.`);

  const archive = await unzipper.Open.buffer(buffer);
  let base = "";
  for (const file of archive.files) {
    if (file.type === "Directory") continue;
    const outPath = join(dir, file.path);
    writeFileSync(outPath, await file.buffer());
    if (file.path.toLowerCase().endsWith(".shp")) base = outPath.slice(0, -4);
  }
  if (!base) throw new Error("No .shp file found in the downloaded zip");
  return base;
}

async function main() {
  const supabase = createServiceSupabase();

  // The shapefile covers every parcel in the county (~hundreds of thousands);
  // county_parcels only tracks the single-family-like subset
  // scripts/sync-pinellas-parcels.ts kept. Filtering to known STRAPs while
  // parsing — rather than updating row by row — means the upsert below only
  // ever touches rows that already exist (never inserts a bare new one).
  console.log("Loading known STRAPs from county_parcels...");
  const knownStraps = new Set<string>();
  const PAGE_SIZE = 1000;
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase.from("county_parcels").select("strap").range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`Failed to load known STRAPs: ${error.message}`);
    for (const row of data ?? []) knownStraps.add(row.strap);
    if (!data || data.length < PAGE_SIZE) break;
  }
  console.log(`${knownStraps.size.toLocaleString()} known STRAPs.`);

  const dir = mkdtempSync(join(tmpdir(), "pcpao-parcel-labels-"));
  try {
    const base = await downloadAndExtract(dir);

    console.log("Parsing shapefile and reprojecting...");
    const source = await shapefile.open(`${base}.shp`, `${base}.dbf`);
    const updates: { strap: string; lat: number; lon: number }[] = [];
    let scanned = 0;
    let result;
    while ((result = await source.read()) && !result.done) {
      scanned += 1;
      const feature = result.value;
      const strap = feature.properties?.STRAP as string | undefined;
      const coords = feature.geometry?.type === "Point" ? feature.geometry.coordinates : null;
      if (!strap || !coords || !knownStraps.has(strap)) continue;
      const [lon, lat] = proj4(SOURCE_PROJECTION, "WGS84", coords) as [number, number];
      updates.push({ strap, lat, lon });
    }
    console.log(`Scanned ${scanned.toLocaleString()} parcel points countywide, ${updates.length.toLocaleString()} matched a known STRAP.`);

    console.log("Upserting county_parcels.lat/lon...");
    const CHUNK_SIZE = 1000;
    let upserted = 0;
    for (let i = 0; i < updates.length; i += CHUNK_SIZE) {
      const chunk = updates.slice(i, i + CHUNK_SIZE);
      const { error } = await supabase.from("county_parcels").upsert(chunk, { onConflict: "strap" });
      if (error) throw new Error(`Upsert failed at row ${i}: ${error.message}`);
      upserted += chunk.length;
      if (upserted % 20_000 < CHUNK_SIZE) console.log(`  ...${upserted.toLocaleString()} upserted`);
    }

    console.log(`Done. ${upserted.toLocaleString()} county_parcels rows now have coordinates.`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
