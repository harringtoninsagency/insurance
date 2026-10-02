import { readFileSync } from "node:fs";
import MsgReader from "@kenjiuno/msgreader";
import { decompressRTF } from "@kenjiuno/decompressrtf";

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

export interface ListingPhoto {
  mlsId: string;
  url: string;
}

const MEDIA_IMG_RE = /<img[^>]*\bsrc="(https:\/\/media\.stellar\.mlsmatrix\.com\/[^"]+)"[^>]*>/gi;
const MLS_ID_RE = /MLS\s*#\s*(?:<[^>]*>\s*)*([A-Z0-9]{6,})/i;

// Splits the HTML on the same Stellar-media <img> markers extractListingPhotos
// uses, pairing each with the markup that follows it up to the next photo (or
// the end of the document) — same "photo, then everything up to the next
// photo" windowing, so listing detail and photo extraction stay paired by
// construction instead of needing to be correlated after the fact.
function listingWindows(html: string): string[] {
  const imgs = [...html.matchAll(MEDIA_IMG_RE)];
  return imgs.map((img, i) => {
    const start = (img.index ?? 0) + img[0].length;
    const end = imgs[i + 1]?.index ?? html.length;
    return html.slice(start, end);
  });
}

/**
 * Pulls each listing's photo out of a OneHome saved-search email's HTML. Each
 * highlighted listing is an <img> on Stellar's media server followed by its
 * "MLS #..." text, so a photo is paired with the first MLS number that
 * appears before the next photo. Source-agnostic: works on HTML from a .msg
 * file, an .eml/Gmail message, or Microsoft Graph. Only the listing thumbnails
 * are returned (the email's own logo/badge images are hosted elsewhere).
 */
export function extractListingPhotos(html: string): ListingPhoto[] {
  const imgs = [...html.matchAll(MEDIA_IMG_RE)];
  const photos: ListingPhoto[] = [];
  imgs.forEach((img, i) => {
    const end = imgs[i + 1]?.index ?? html.length;
    const window = html.slice((img.index ?? 0) + img[0].length, end);
    const mls = window.match(MLS_ID_RE)?.[1];
    if (mls) photos.push({ mlsId: mls.toUpperCase(), url: img[1]!.replace(/&amp;/g, "&") });
  });
  return photos;
}

// Tolerant of the source template's inconsistent quoting (price uses single
// quotes, the rest double) and arbitrary inline `style="..."` attributes
// between the class and the `>` — matches on the class name only, not the
// full tag.
function fieldText(window: string, className: string): string | null {
  const re = new RegExp(`class=['"]${className}['"][^>]*>([^<]*)<`, "i");
  return window.match(re)?.[1]?.trim() || null;
}

/**
 * Extracts each highlighted listing's price/type/address/specs/MLS# directly
 * from a OneHome saved-search email's HTML, instead of from a plain-text
 * body. Needed because Gmail (via IMAP) doesn't server-side-convert HTML to
 * plain text the way Microsoft Graph did for the Outlook mailbox this was
 * originally built against — a Gmail-sourced message's "plain text" can be
 * the raw HTML source with tags stripped, not a clean linearized layout, so
 * `parseOneHomeListingsFromText`'s block regex never matches it. Same
 * source-agnostic reasoning as `extractListingPhotos`: works on HTML from a
 * .msg file, an .eml/Gmail message, or Microsoft Graph.
 */
export function parseOneHomeListingsFromHtml(html: string): ParsedListing[] {
  const listings: ParsedListing[] = [];

  for (const window of listingWindows(html)) {
    const priceText = fieldText(window, "highlight-price");
    const propertyType = fieldText(window, "highlight-title");
    const streetAddress = fieldText(window, "highlight-description");
    const cityState = fieldText(window, "highlight-address");
    const mlsId = window.match(MLS_ID_RE)?.[1];

    const price = priceText?.match(/\$?([\d,]+)/)?.[1];
    const cityMatch = cityState?.match(/^([A-Za-z .'-]+),\s*Florida\s+(\d{5})$/);
    const beds = window.match(/>(\d+)\s*bd</)?.[1];
    const baths = window.match(/>(\d+)\s*ba</)?.[1];
    const sqft = window.match(/>([\d,]+)\s*sqft</)?.[1];

    if (!price || !propertyType || !streetAddress || !cityMatch || !beds || !baths || !sqft || !mlsId) {
      console.warn("Skipping unparseable listing window near MLS:", mlsId ?? "(none found)");
      continue;
    }

    listings.push({
      listPrice: toNumber(price),
      propertyType,
      streetAddress,
      city: cityMatch[1]!.trim(),
      state: "FL",
      zip: cityMatch[2]!,
      beds: toNumber(beds),
      baths: toNumber(baths),
      sqft: toNumber(sqft),
      mlsId: mlsId.toUpperCase(),
    });
  }

  return listings;
}

/**
 * Outlook .msg exports often carry the HTML body only inside the compressed
 * RTF field (as encapsulated HTML), with no separate HTML body — so read it
 * from there when a plain HTML body isn't present.
 */
export function readMsgHtml(msgFilePath: string): string {
  const reader = new MsgReader(readFileSync(msgFilePath) as unknown as ArrayBuffer);
  const data = reader.getFileData();
  if (data.bodyHtml) return data.bodyHtml;
  if (data.html) return Buffer.from(data.html).toString("utf8");
  if (data.compressedRtf) {
    return Buffer.from(decompressRTF(Array.from(data.compressedRtf))).toString("latin1");
  }
  return "";
}

/** Splits "9913 W BAY ST" into { houseNumber: "9913", street: "W BAY ST" }. */
export function splitStreetAddress(streetAddress: string): { houseNumber: string; street: string } {
  // A trailing letter (e.g. "1121A ORANGE AVE") is a legitimate house-number
  // suffix some FL addresses use, not a unit designator (those come after
  // the street name — see stripUnitDesignator in county-parcels.ts).
  const match = streetAddress.match(/^(\d+[A-Za-z]?)\s+(.+)$/);
  if (!match || !match[1] || !match[2]) {
    throw new Error(`Could not split house number from street address: "${streetAddress}"`);
  }
  return { houseNumber: match[1], street: match[2] };
}
