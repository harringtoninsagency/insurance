// One-time (re-runnable) ETL: syncs the most recent roof permit per parcel from
// PCPAO's official RP_PERMITS bulk export (all issuing agencies — the county
// and every city) into `county_roof_permits`. Refresh periodically; permit
// data changes daily upstream.
//
// Usage: npx tsx scripts/sync-pinellas-permits.ts
//
// Offline only (downloads ~60MB zipped, streams 1.6M rows) — never run this
// inside a Next.js request.

import { resolve } from "node:path";
import { createServiceSupabase } from "@/lib/supabase/server";
import { downloadTableJsonStream, streamEachRecord } from "@/lib/enrichment/pcpao-bulk";

process.loadEnvFile(resolve(import.meta.dirname, "../.env.local"));

// PCPAO normalizes roof permits to PERMIT_TYPE "96" / PERMIT_DSCR "ROOF" across
// every agency (verified against the full export: all 428k roof-related rows
// use exactly this pair), so this is an exact match rather than text guessing.
const ROOF_PERMIT_TYPE = "96";

// The type covers repairs as well as replacements, and PCPAO doesn't say which.
// A small patch permit would otherwise make a decades-old roof look brand new
// and understate the risk, so permits below this estimated value (or with no
// value recorded) are ignored — erring toward the older roof.
const MIN_ESTIMATED_VALUE = 3000;

interface RoofPermitRow {
  strap: string;
  parcel_number: string | null;
  permit_number: string | null;
  agency_name: string | null;
  issue_dt: string;
  roof_year: number;
  est_val: number;
  roof_permit_count: number;
}

async function main() {
  const latestByStrap = new Map<string, RoofPermitRow>();

  console.log("Streaming RP_PERMITS (roof permits only)...");
  const stream = await downloadTableJsonStream("RP_PERMITS");
  const scanned = await streamEachRecord(stream, (row) => {
    if (row.PERMIT_TYPE !== ROOF_PERMIT_TYPE || !row.STRAP) return;
    const estVal = Number(row.EST_VAL);
    if (!Number.isFinite(estVal) || estVal < MIN_ESTIMATED_VALUE) return;
    const issueDate = row.ISSUE_DT?.slice(0, 10);
    if (!issueDate || !/^\d{4}-\d{2}-\d{2}$/.test(issueDate)) return;

    const existing = latestByStrap.get(row.STRAP);
    const count = (existing?.roof_permit_count ?? 0) + 1;
    if (existing && existing.issue_dt >= issueDate) {
      existing.roof_permit_count = count;
      return;
    }
    latestByStrap.set(row.STRAP, {
      strap: row.STRAP,
      parcel_number: row.PARCEL_NUMBER || null,
      permit_number: row.PERMIT_NUMBER || null,
      agency_name: row.AGENCY_NAME || null,
      issue_dt: issueDate,
      roof_year: Number.parseInt(issueDate.slice(0, 4), 10),
      est_val: estVal,
      roof_permit_count: count,
    });
  });
  console.log(`  scanned ${scanned.toLocaleString()} permits, ${latestByStrap.size.toLocaleString()} parcels with a qualifying roof permit`);

  const supabase = createServiceSupabase();
  const rows = Array.from(latestByStrap.values());
  const CHUNK_SIZE = 1000;
  let upserted = 0;
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    const { error } = await supabase.from("county_roof_permits").upsert(chunk, { onConflict: "strap" });
    if (error) throw new Error(`Upsert failed at row ${i}: ${error.message}`);
    upserted += chunk.length;
    if (upserted % 20_000 < CHUNK_SIZE) console.log(`  ...${upserted.toLocaleString()} upserted`);
  }
  console.log(`Done. ${upserted.toLocaleString()} parcels synced.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
