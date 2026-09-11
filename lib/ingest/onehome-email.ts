import { readFileSync } from "node:fs";
import MsgReader from "@kenjiuno/msgreader";

export interface ParsedListing {
  listPrice: number;
  propertyType: string;
  streetAddress: string;
  city: string;
  state: string;
  zip: string | null;
  beds: number;
  baths: number;
  sqft: number;
  mlsId: string;
}

// Matches one "Highlights" block from a OneHome saved-search email, e.g.:
//   $599,000
//   Residential
//   9913 W BAY ST
//   SEMINOLE, Florida 33776
//   3 bd • 3 ba • 1,928 sqft
//   MLS #TB8537541
const LISTING_BLOCK_RE =
  /\$([\d,]+)\s*\n+\s*([A-Za-z][A-Za-z ]*?)\s*\n+\s*([A-Za-z0-9 .'-]+?)\s*\n+\s*([A-Za-z .'-]+),\s*Florida\s+(\d{5})\s*\n+\s*(\d+)\s*bd\s*•\s*(\d+)\s*ba\s*•\s*([\d,]+)\s*sqft\s*\n+\s*MLS\s*#(\w+)/g;

function toNumber(value: string): number {
  return Number(value.replace(/,/g, ""));
}

/**
 * Extracts the ~10 "Highlights" listings inlined in a OneHome saved-search
 * email's plain-text body. The remaining listings in a "38 new or updated"
 * email are only reachable via the portal's "View All Properties" page,
 * which is deliberately not automated (see plan notes on Incapsula
 * bot-detection). Malformed/unrecognized blocks are skipped and logged, not
 * thrown on, since this parses an externally-controlled email template that
 * could shift. Shared by both the manual .msg CLI path and the automated
 * Graph-mail fetch, which retrieve the same plain-text body via different
 * transports.
 */
export function parseOneHomeListingsFromText(body: string): ParsedListing[] {
  const listings: ParsedListing[] = [];
  for (const match of body.matchAll(LISTING_BLOCK_RE)) {
    const [, price, propertyType, streetAddress, city, zip, beds, baths, sqft, mlsId] = match;
    if (!price || !propertyType || !streetAddress || !city || !zip || !beds || !baths || !sqft || !mlsId) {
      console.warn("Skipping unparseable listing block near:", match[0].slice(0, 80));
      continue;
    }
    listings.push({
      listPrice: toNumber(price),
      propertyType: propertyType.trim(),
      streetAddress: streetAddress.trim(),
      city: city.trim(),
      state: "FL",
      zip,
      beds: toNumber(beds),
      baths: toNumber(baths),
      sqft: toNumber(sqft),
      mlsId,
    });
  }

  return listings;
}

/** Reads a OneHome saved-search .msg file and parses its highlighted listings. */
export function parseOneHomeEmail(msgFilePath: string): ParsedListing[] {
  const buffer = readFileSync(msgFilePath);
  // MsgReader's declared type wants ArrayBuffer|DataView, but it only ever
  // does byte-indexed reads, so a Node Buffer (a Uint8Array subclass) works
  // fine in practice.
  const reader = new MsgReader(buffer as unknown as ArrayBuffer);
  const body = reader.getFileData().body;
  if (!body) {
    throw new Error(`${msgFilePath} has no plain-text body to parse`);
  }
  return parseOneHomeListingsFromText(body);
}

/** Splits "9913 W BAY ST" into { houseNumber: "9913", street: "W BAY ST" }. */
export function splitStreetAddress(streetAddress: string): { houseNumber: string; street: string } {
  const match = streetAddress.match(/^(\d+)\s+(.+)$/);
  if (!match || !match[1] || !match[2]) {
    throw new Error(`Could not split house number from street address: "${streetAddress}"`);
  }
  return { houseNumber: match[1], street: match[2] };
}
