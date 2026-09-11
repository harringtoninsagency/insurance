import type { ParsedListing } from "@/lib/ingest/onehome-email";

// Splits a CSV line on commas not inside a quoted field, then strips the
// surrounding quotes each field's export wraps every value in.
const CSV_LINE_SPLIT_RE = /,(?=(?:[^"]*"[^"]*")*[^"]*$)/;

function unquote(field: string): string {
  return field.trim().replace(/^"(.*)"$/, "$1");
}

function digitsOnly(value: string): number {
  return Number(value.replace(/[^0-9]/g, ""));
}

/**
 * Parses a "homes for sale" CSV export (MLS #, Status, Price, Address, City,
 * Property Type, Beds, Baths, Square Footage, Lot Size, ...). No zip column
 * exists in this export format, so `zip` comes back null — county-parcel
 * matching only uses zip as a tiebreaker for ambiguous matches, not a
 * requirement. Price and Square Footage carry stray "undefined" suffixes and
 * comma thousands-separators in some export rows; both are stripped by
 * taking digits only.
 */
export function parseListingsCsv(csvText: string): ParsedListing[] {
  const lines = csvText.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const [header, ...rows] = lines;
  if (!header) return [];

  const columns = header.split(CSV_LINE_SPLIT_RE).map((c) => unquote(c).toLowerCase());
  const colIndex = (name: string) => columns.indexOf(name);

  const idxMls = colIndex("mls #");
  const idxPrice = colIndex("price");
  const idxAddress = colIndex("address");
  const idxCity = colIndex("city");
  const idxPropertyType = colIndex("property type");
  const idxBeds = colIndex("beds");
  const idxBaths = colIndex("baths");
  const idxSqft = colIndex("square footage");

  const listings: ParsedListing[] = [];
  for (const line of rows) {
    const fields = line.split(CSV_LINE_SPLIT_RE).map(unquote);
    const mlsId = fields[idxMls];
    const streetAddress = fields[idxAddress];
    const city = fields[idxCity];
    const priceRaw = fields[idxPrice];
    const sqftRaw = fields[idxSqft];
    const bedsRaw = fields[idxBeds];
    const bathsRaw = fields[idxBaths];

    if (!mlsId || !streetAddress || !city || !priceRaw || !sqftRaw || !bedsRaw || !bathsRaw) {
      console.warn("Skipping unparseable CSV row:", line.slice(0, 80));
      continue;
    }

    listings.push({
      listPrice: digitsOnly(priceRaw),
      propertyType: fields[idxPropertyType]?.trim() || "Residential",
      streetAddress: streetAddress.trim(),
      city: city.trim(),
      state: "FL",
      zip: null,
      beds: Number(bedsRaw),
      baths: Number(bathsRaw),
      sqft: digitsOnly(sqftRaw),
      mlsId,
    });
  }

  return listings;
}
