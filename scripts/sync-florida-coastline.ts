// One-time (re-runnable) ETL: downloads USGS's republished copy of NOAA's
// medium-resolution US shoreline (ALLUS80K — 1:80,000-scale, continental US
// only, no Hawaii/Alaska/territories), filters it down to Florida (the full
// CONUS coastline is ~2.5 million points — far too large for a single
// Supabase RPC call, and this app only ever needs Florida distances anyway),
// and loads it into public.florida_coastline (a single row) for
// lib/enrichment/coastline-distance.ts to query locally via PostGIS rather
// than depending on a live distance API.
// https://pubs.usgs.gov/of/2005/1071/htmldocs/catalog.htm
//
// The source shapefile is one giant MultiPolygon (the outline of the land
// itself, in NAD83 degrees — close enough to WGS84 to treat as the same at
// mile-scale distances). We store its boundary (the coastline curve) rather
// than the filled polygon: ST_Distance from a point to a filled polygon is 0
// for any point already inside it (i.e. every inland property), which is
// useless here — the boundary is the line we actually want distance to, for
// both inland and offshore points alike.
//
// Usage: npx tsx scripts/sync-florida-coastline.ts

import { loadEnvIfPresent } from "@/lib/env";
loadEnvIfPresent();

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import unzipper from "unzipper";
// Namespace import, not default — see the comment in
// scripts/sync-pinellas-parcel-coordinates.ts for why.
import * as shapefile from "shapefile";
import { createServiceSupabase } from "@/lib/supabase/server";

const SHORELINE_ZIP_URL = "https://pubs.usgs.gov/of/2005/1071/data/background/us_bnds/allus80k.zip";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

async function downloadAndExtract(dir: string): Promise<string> {
  const res = await fetch(SHORELINE_ZIP_URL, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`Failed to download shoreline shapefile: HTTP ${res.status}`);
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

// GeoJSON ring: [[lon, lat], ...]. WKT wants "lon lat, lon lat, ...".
// 5 decimal places is ~1.1m precision — plenty for a mile-scale distance,
// and meaningfully shrinks the WKT payload against Supabase's RPC body
// limit versus the source data's full ~8-decimal precision.
function ringToWkt(ring: number[][]): string {
  return `(${ring.map(([lon, lat]) => `${lon!.toFixed(5)} ${lat!.toFixed(5)}`).join(",")})`;
}

// Iterative Douglas-Peucker (explicit stack, not recursion — some coastline
// rings run tens of thousands of points long). The full dataset's ~1.2M
// points for Florida alone is both too slow to insert in one statement and
// far more precision than a mile-scale "distance to coast" ever needs;
// ~35m tolerance keeps every real bay/inlet/point while dropping the dense
// nearly-straight runs, which is most of a 1:80,000-scale survey's points.
const SIMPLIFY_TOLERANCE_DEG = 0.00035;

function perpendicularDistance(p: [number, number], a: [number, number], b: [number, number]): number {
  const [px, py] = p;
  const [ax, ay] = a;
  const [bx, by] = b;
  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay);
  const t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function simplifyRing(ring: number[][], tolerance: number): number[][] {
  if (ring.length <= 2) return ring;
  const points = ring as [number, number][];
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [start, end] = stack.pop()!;
    let maxDist = 0;
    let maxIdx = -1;
    for (let i = start + 1; i < end; i++) {
      const d = perpendicularDistance(points[i]!, points[start]!, points[end]!);
      if (d > maxDist) {
        maxDist = d;
        maxIdx = i;
      }
    }
    if (maxDist > tolerance && maxIdx !== -1) {
      keep[maxIdx] = 1;
      stack.push([start, maxIdx], [maxIdx, end]);
    }
  }
  return points.filter((_, i) => keep[i] === 1);
}

// Florida plus generous padding (the Georgia/Alabama border area, and well
// out into the Gulf/Atlantic) — this app only ever needs coastline distance
// for Florida properties, and the full CONUS dataset is ~2.5 million points,
// large enough to blow past Supabase's request-body limit in one RPC call.
// A ring is kept whole if ANY of its points falls in this box, so a ring that
// mostly hugs the coast but dips slightly outside it (e.g. near the FL/GA
// line) isn't cut mid-ring.
const FLORIDA_BOUNDS = { minLon: -87.7, maxLon: -79.9, minLat: 24.3, maxLat: 31.1 };
function ringTouchesFlorida(ring: number[][]): boolean {
  return ring.some((point) => {
    const [lon, lat] = point as [number, number];
    return lon >= FLORIDA_BOUNDS.minLon && lon <= FLORIDA_BOUNDS.maxLon && lat >= FLORIDA_BOUNDS.minLat && lat <= FLORIDA_BOUNDS.maxLat;
  });
}

async function main() {
  const dir = mkdtempSync(join(tmpdir(), "us-coastline-"));
  try {
    const base = await downloadAndExtract(dir);

    console.log("Parsing shapefile...");
    const source = await shapefile.open(`${base}.shp`, `${base}.dbf`);
    const polygonRings: number[][][][] = [];
    let result;
    while ((result = await source.read()) && !result.done) {
      const geometry = result.value.geometry;
      if (geometry?.type === "MultiPolygon") polygonRings.push(...geometry.coordinates);
      else if (geometry?.type === "Polygon") polygonRings.push(geometry.coordinates);
    }
    const totalPoints = polygonRings.reduce((sum, poly) => sum + poly.reduce((s, ring) => s + ring.length, 0), 0);
    console.log(`Parsed ${polygonRings.length.toLocaleString()} polygon(s), ${totalPoints.toLocaleString()} points total (continental US).`);

    const floridaRings = polygonRings.map((poly) => poly.filter(ringTouchesFlorida)).filter((poly) => poly.length > 0);
    const floridaPoints = floridaRings.reduce((sum, poly) => sum + poly.reduce((s, ring) => s + ring.length, 0), 0);
    console.log(`${floridaRings.reduce((s, p) => s + p.length, 0).toLocaleString()} ring(s), ${floridaPoints.toLocaleString()} points within the Florida bounding box.`);

    const simplifiedRings = floridaRings.map((poly) => poly.map((ring) => simplifyRing(ring, SIMPLIFY_TOLERANCE_DEG)));
    const simplifiedPoints = simplifiedRings.reduce((sum, poly) => sum + poly.reduce((s, ring) => s + ring.length, 0), 0);
    console.log(`${simplifiedPoints.toLocaleString()} points after simplification (tolerance ${SIMPLIFY_TOLERANCE_DEG} deg).`);

    // The coastline (boundary) of a polygon is the same set of rings as the
    // polygon itself — ST_Boundary of a polygon returns its rings as a
    // MultiLineString, which is exactly this GeoJSON structure already.
    const multiLineWkt = `MULTILINESTRING(${simplifiedRings.flatMap((poly) => poly.map(ringToWkt)).join(",")})`;
    console.log(`WKT payload: ${(Buffer.byteLength(multiLineWkt) / 1e6).toFixed(1)} MB.`);

    console.log("Upserting into florida_coastline...");
    const supabase = createServiceSupabase();
    const { error } = await supabase.rpc("load_florida_coastline", {
      p_wkt: multiLineWkt,
      p_source: "USGS allus80k (NOAA medium-resolution US shoreline, continental US only)",
    });
    if (error) throw new Error(`Failed to load coastline: ${error.message}`);

    console.log("Done.");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
