import unzipper from "unzipper";

// Helpers for the Hernando County Property Appraiser's official bulk CAMA
// export (https://hernandocountypa-florida.us/Downloads -> "Comprehensive
// CAMA Dataset") — a free, self-serve, sanctioned download, same standing as
// PCPAO's Raw Database Files (lib/enrichment/pcpao-bulk.ts) and Pasco's
// weekly feed (lib/enrichment/pascopa-bulk.ts). Each table is a single
// fixed-width text file in a small zip (no delimiter, no header row) — field
// positions come from the matching "<TABLE> File Record Layout.txt" also
// published on that page, 1-indexed and inclusive like a COBOL copybook.

const BASE_URL = "https://hernandocountypa-florida.us/download";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

export async function downloadHernandoTableText(tableName: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/${tableName}.ZIP`, {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!res.ok) {
    throw new Error(`Failed to download ${tableName}.ZIP: HTTP ${res.status}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  const directory = await unzipper.Open.buffer(buffer);
  const entry = directory.files[0];
  if (!entry) {
    throw new Error(`${tableName}.ZIP contained no entries`);
  }
  const content = await entry.buffer();
  console.log(`Downloaded ${tableName} (${(buffer.length / 1e6).toFixed(1)} MB zipped, ${(content.length / 1e6).toFixed(1)} MB unzipped)`);
  // latin1, not utf-8: a fixed-width mainframe-style export with no declared
  // encoding, and byte-for-byte latin1 decoding is what keeps every field's
  // documented start/end byte position lining up with its string index.
  return content.toString("latin1");
}

/** Reads a 1-indexed, inclusive, fixed-width field — the record layout docs' own convention. */
export function fixedField(line: string, start: number, end: number): string {
  return line.slice(start - 1, end).trim();
}

export function parseFixedWidthLines(text: string): string[] {
  return text.split(/\r?\n/).filter((line) => line.trim().length > 0);
}
