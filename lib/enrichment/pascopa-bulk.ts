import unzipper from "unzipper";

// Helpers for the Pasco County Property Appraiser's official weekly bulk
// data feed (https://pascopa.com/information-and-tools/downloads/ ->
// downloads.pascopa.com -> "Real Estate" -> ftp01.pascopa.com/real_estate/)
// — a sanctioned export, same standing as PCPAO's Raw Database Files used
// for Pinellas (see lib/enrichment/pcpao-bulk.ts). Files here are proper
// quoted CSV (unlike PCPAO's malformed-trailing-comma JSON) and small enough
// (single-digit MB zipped) to buffer fully in memory rather than stream.

const BASE_URL = "https://ftp01.pascopa.com/real_estate";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

export async function downloadPascoTableCsv(tableName: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/${tableName}.zip`, {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!res.ok) {
    throw new Error(`Failed to download ${tableName}.zip: HTTP ${res.status}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  const directory = await unzipper.Open.buffer(buffer);
  const entry = directory.files[0];
  if (!entry) {
    throw new Error(`${tableName}.zip contained no entries`);
  }
  const content = await entry.buffer();
  console.log(`Downloaded ${tableName} (${(buffer.length / 1e6).toFixed(1)} MB zipped, ${(content.length / 1e6).toFixed(1)} MB unzipped)`);
  return content.toString("utf-8");
}

// Splits a CSV line on commas not inside a quoted field — same approach as
// lib/ingest/csv-listings.ts. Every field in Pasco's export is quoted, and
// no field observed contains an embedded comma or escaped quote, so this
// simple split is sufficient (no need for a full RFC4180 parser).
const CSV_LINE_SPLIT_RE = /,(?=(?:[^"]*"[^"]*")*[^"]*$)/;

function unquote(field: string): string {
  return field.trim().replace(/^"(.*)"$/, "$1");
}

/** Parses a full quoted-CSV table into header-keyed row objects. */
export function parsePascoCsv(csvText: string): Record<string, string>[] {
  const lines = csvText.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const [header, ...rows] = lines;
  if (!header) return [];
  const columns = header.split(CSV_LINE_SPLIT_RE).map(unquote);
  return rows.map((line) => {
    const values = line.split(CSV_LINE_SPLIT_RE).map(unquote);
    const record: Record<string, string> = {};
    columns.forEach((col, i) => {
      record[col] = values[i] ?? "";
    });
    return record;
  });
}
