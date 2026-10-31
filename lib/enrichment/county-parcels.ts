import { createServiceSupabase } from "@/lib/supabase/server";
import type { Database } from "@/lib/types/database";

type PropertyRow = Database["public"]["Tables"]["properties"]["Row"];
type CountyParcelRow = Database["public"]["Tables"]["county_parcels"]["Row"];

// County data splits directional pre-/post-fixes into their own fields
// (STR_PFX_DIR/STR_SFX_DIR) — str_name is always just the bare name, e.g.
// "9913 W BAY ST" is str_num=9913, str_name=BAY, str_sfx=ST (the "W" isn't
// part of str_name at all). Directionals can appear leading ("N Glenwood
// Ave") or trailing ("69th St N") depending on the address.
const DIRECTIONALS = [
  "n",
  "s",
  "e",
  "w",
  "ne",
  "nw",
  "se",
  "sw",
  "north",
  "south",
  "east",
  "west",
  "northeast",
  "northwest",
  "southeast",
  "southwest",
];

const STREET_SUFFIXES = [
  "court",
  "ct",
  "road",
  "rd",
  "drive",
  "dr",
  "street",
  "st",
  "avenue",
  "ave",
  "lane",
  "ln",
  "boulevard",
  "blvd",
  "way",
  "circle",
  "cir",
  "place",
  "pl",
  "terrace",
  "ter",
  "trail",
  "trl",
  "plaza",
  "plz",
  // Added once Pasco's site_addresses.csv surfaced real suffix words this
  // list was missing (Pinellas's own str_sfx values come pre-abbreviated by
  // PCPAO, so this gap was latent there — Pasco's spelled-out STREET_SUFFIX
  // column exposed it directly).
  "isle",
  "bend",
  "bnd",
  "cove",
  "cv",
  "parkway",
  "pkwy",
  "loop",
  "highway",
  "hwy",
  "row",
  "crescent",
  "cres",
  "run",
  "path",
  "square",
  "sq",
  "pass",
  "trace",
  "trce",
  "alley",
  "aly",
  "point",
  "pt",
  "spur",
  "branch",
  "br",
  "walk",
  "manor",
  "mnr",
  "view",
  "vw",
  "bypass",
  "byp",
  "corner",
  "cor",
  "crossing",
  "xing",
  "mill",
  "forge",
  "frg",
  "pike",
  "landing",
  "lndg",
];

// Strips a trailing unit/apartment/suite designator (e.g. "#1", "Unit 2",
// "Apt B", "Ste 300") that the county's single-family parcel data has no
// concept of — a trailing "#1" left in place would otherwise become part of
// the "street name" and never match anything, silently failing a lookup that
// should otherwise succeed on the base address.
const UNIT_DESIGNATORS = ["unit", "apt", "apartment", "ste", "suite", "#"];

function stripUnitDesignator(street: string): string {
  const words = street.trim().split(/\s+/);
  if (words.length > 1 && words[words.length - 1]!.startsWith("#")) {
    return words.slice(0, -1).join(" ");
  }
  const secondToLast = words[words.length - 2]?.toLowerCase();
  if (words.length > 2 && secondToLast && UNIT_DESIGNATORS.includes(secondToLast)) {
    return words.slice(0, -2).join(" ");
  }
  return street;
}

export function normalizeStreetName(street: string): string {
  // Strip trailing punctuation (e.g. "Rd." or "St,") before splitting into
  // words — otherwise "rd." never matches the bare "rd" in STREET_SUFFIXES
  // and the real suffix is left in place, breaking the match below.
  let words = stripUnitDesignator(street).trim().toLowerCase().replace(/[.,]+$/, "").split(/\s+/);
  if (words.length > 1 && DIRECTIONALS.includes(words[0]!)) {
    words = words.slice(1);
  }
  const trailing = words[words.length - 1];
  if (words.length > 1 && trailing && DIRECTIONALS.includes(trailing)) {
    words = words.slice(0, -1);
  }
  const suffix = words[words.length - 1];
  if (words.length > 1 && suffix && STREET_SUFFIXES.includes(suffix)) {
    words = words.slice(0, -1);
  }
  return words.join(" ");
}

// County data's own str_sfx is already an abbreviation (e.g. "PLZ", "ST",
// "AVE") — maps a source address's written-out-or-abbreviated suffix word to
// that same abbreviation so it can be used as a tiebreaker when stripping the
// suffix (to match street name across differing suffixes, e.g. "BAY ST" vs
// "BAY PLZ") produces multiple candidates at the same house number.
export const SUFFIX_ABBREVIATIONS: Record<string, string> = {
  court: "ct",
  ct: "ct",
  road: "rd",
  rd: "rd",
  drive: "dr",
  dr: "dr",
  street: "st",
  st: "st",
  avenue: "ave",
  ave: "ave",
  lane: "ln",
  ln: "ln",
  boulevard: "blvd",
  blvd: "blvd",
  way: "way",
  circle: "cir",
  cir: "cir",
  place: "pl",
  pl: "pl",
  terrace: "ter",
  ter: "ter",
  trail: "trl",
  trl: "trl",
  plaza: "plz",
  plz: "plz",
  isle: "isle",
  bend: "bnd",
  bnd: "bnd",
  cove: "cv",
  cv: "cv",
  parkway: "pkwy",
  pkwy: "pkwy",
  loop: "loop",
  highway: "hwy",
  hwy: "hwy",
  row: "row",
  crescent: "cres",
  cres: "cres",
  run: "run",
  path: "path",
  square: "sq",
  sq: "sq",
  pass: "pass",
  trace: "trce",
  trce: "trce",
  alley: "aly",
  aly: "aly",
  point: "pt",
  pt: "pt",
  spur: "spur",
  branch: "br",
  br: "br",
  walk: "walk",
  manor: "mnr",
  mnr: "mnr",
  view: "vw",
  vw: "vw",
  bypass: "byp",
  byp: "byp",
  corner: "cor",
  cor: "cor",
  crossing: "xing",
  xing: "xing",
  mill: "mill",
  forge: "frg",
  frg: "frg",
  pike: "pike",
  landing: "lndg",
  lndg: "lndg",
};

function extractSuffixAbbreviation(street: string): string | null {
  let words = stripUnitDesignator(street).trim().toLowerCase().split(/\s+/);
  if (words.length > 1 && DIRECTIONALS.includes(words[0]!)) {
    words = words.slice(1);
  }
  const trailing = words[words.length - 1];
  if (words.length > 1 && trailing && DIRECTIONALS.includes(trailing)) {
    words = words.slice(0, -1);
  }
  const suffix = words[words.length - 1];
  return suffix ? (SUFFIX_ABBREVIATIONS[suffix] ?? null) : null;
}

const DIRECTIONAL_ABBREVIATIONS: Record<string, string> = {
  n: "n",
  north: "n",
  s: "s",
  south: "s",
  e: "e",
  east: "e",
  w: "w",
  west: "w",
  ne: "ne",
  northeast: "ne",
  nw: "nw",
  northwest: "nw",
  se: "se",
  southeast: "se",
  sw: "sw",
  southwest: "sw",
};

// The county sync doesn't persist a separate directional column (PCPAO's raw
// export splits it into its own STR_PFX_DIR/STR_SFX_DIR fields, but
// sync-pinellas-parcels.ts doesn't capture those) — the directional is only
// recoverable from the free-text `site_address` it does store, e.g.
// "4626 10TH AVE S" vs "4626 10TH AVE N", where it's reliably the last token.
function extractDirectional(street: string): string | null {
  const words = stripUnitDesignator(street).trim().toLowerCase().split(/\s+/);
  if (words.length > 1 && DIRECTIONALS.includes(words[0]!)) {
    return DIRECTIONAL_ABBREVIATIONS[words[0]!] ?? null;
  }
  const trailing = words[words.length - 1];
  if (words.length > 1 && trailing && DIRECTIONALS.includes(trailing)) {
    return DIRECTIONAL_ABBREVIATIONS[trailing] ?? null;
  }
  return null;
}

function extractParcelDirectional(siteAddress: string | null): string | null {
  if (!siteAddress) return null;
  const words = siteAddress.trim().toLowerCase().split(/\s+/);
  const last = words[words.length - 1];
  return last ? (DIRECTIONAL_ABBREVIATIONS[last] ?? null) : null;
}

// Why a property came back with no county match — lets the caller tell a
// producer "this address looks wrong" apart from "this address is probably
// right but our matching has a gap". usps_address_not_found is set upstream,
// by applyCountyEnrichment, before findCountyParcel even runs; the other
// three are set by findCountyParcel itself.
export type CountyParcelMissReason =
  | "usps_address_not_found" // USPS has no such deliverable address at all — almost always bad source data (typo'd number, wrong street), not a gap in our county sync
  | "no_candidates_at_house_number" // nothing in county records at this house number, on any street — likely a typo'd number, or outside Pinellas/Pasco coverage
  | "no_street_name_match" // other parcels exist at this house number, but none share this street name — likely a typo'd/misheard street name
  | "ambiguous_match"; // multiple parcels share this house number + street name and couldn't be narrowed down — needs a human to pick

export interface CountyParcelLookup {
  parcel: CountyParcelRow | null;
  missReason?: CountyParcelMissReason;
}

// Human-readable version of the above, shared by the quote-request intake
// flow and the "Pull county data" button on a property page — both places
// that need to tell a producer whether a no-match looks like a bad address
// (worth retyping) or a gap in our own matching (worth flagging, not retyping).
export function describeCountyParcelMiss(reason: CountyParcelMissReason | undefined): string {
  switch (reason) {
    case "usps_address_not_found":
      return "USPS couldn't find this as a deliverable address — double-check it for a typo before adding year built / square footage by hand.";
    case "no_street_name_match":
      return "Other properties exist at this house number, but none on this street — double-check the street name for a typo.";
    case "ambiguous_match":
      return "Multiple county property records matched this address and couldn't be narrowed down automatically — a producer needs to confirm the correct one.";
    case "no_candidates_at_house_number":
    default:
      return "No county property record exists at this house number — double-check the address for a typo, or it may be outside Pinellas/Pasco County coverage.";
  }
}

/**
 * Matches a property to a synced county_parcels row by street number + name
 * (+ zip as a confidence check). Returns a null parcel rather than guessing on
 * zero or multiple matches — ambiguity needs a human, not a silent wrong pick.
 */
// This project's PostgREST config hard-caps any single request at 1,000
// rows — confirmed live: requesting .range(0, 9999) still came back with
// exactly 1,000. A common house number (e.g. "2", "100") matches thousands
// of parcels across this table's statewide coverage (up to ~4,050 for the
// single busiest number observed), so a one-shot query silently truncates
// before the street-name filter below ever sees the real match (confirmed
// live: an unambiguous Pinellas match came back "no_street_name_match" this
// way). Paginate in 1,000-row pages instead; MAX_CANDIDATES is a sane upper
// bound so one abnormally common house number can't page forever.
const PARCEL_PAGE_SIZE = 1000;
const MAX_CANDIDATES = 10000;

async function fetchAllByStrNum(supabase: ReturnType<typeof createServiceSupabase>, strNum: string): Promise<CountyParcelRow[]> {
  const rows: CountyParcelRow[] = [];
  for (let offset = 0; offset < MAX_CANDIDATES; offset += PARCEL_PAGE_SIZE) {
    const { data, error } = await supabase
      .from("county_parcels")
      .select("*")
      .eq("str_num", strNum)
      .range(offset, offset + PARCEL_PAGE_SIZE - 1);
    if (error) throw new Error(`County parcel lookup failed: ${error.message}`);
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < PARCEL_PAGE_SIZE) break;
  }
  return rows;
}

export async function findCountyParcel(property: PropertyRow): Promise<CountyParcelLookup> {
  if (!property.house_number || !property.street) {
    return { parcel: null, missReason: "no_candidates_at_house_number" };
  }

  const supabase = createServiceSupabase();
  let data = await fetchAllByStrNum(supabase, property.house_number);

  // A letter-suffixed house number (e.g. "1121A", MLS-style for a duplex or
  // rear unit) usually shares a single base parcel in county records, which
  // carries no such suffix — retry against the bare digits before giving up.
  if (!data.length && /^\d+[A-Za-z]$/.test(property.house_number)) {
    const bareHouseNumber = property.house_number.slice(0, -1);
    data = await fetchAllByStrNum(supabase, bareHouseNumber);
  }

  if (!data.length) return { parcel: null, missReason: "no_candidates_at_house_number" };

  const targetStreet = normalizeStreetName(property.street);
  // row.str_name is already the county's own bare base name, with no suffix
  // or directional attached (those live in str_sfx / the site_address text) —
  // running it back through normalizeStreetName would wrongly strip a second
  // word that happens to also be a suffix in its own right (e.g. "SUN ISLE"
  // loses "isle", since "isle" is itself a valid street suffix elsewhere).
  const matches = data.filter((row) => row.str_name && row.str_name.trim().toLowerCase() === targetStreet);

  if (matches.length === 0) return { parcel: null, missReason: "no_street_name_match" };
  if (matches.length === 1) return { parcel: matches[0] ?? null };

  // Each signal below narrows the candidate pool further rather than being
  // tried independently against the full match set — confirmed live this
  // matters: "701 12TH Avenue N, St Petersburg" (zip 33701) has 5 same-name
  // candidates countywide. Zip alone narrows only to 2 (both St Petersburg,
  // one "AVE S" and one "AVE N", since they share a zip); suffix alone
  // narrows to 3 (every AVE regardless of city/zip); directional alone
  // narrows to 2 (both the St Petersburg and Safety Harbor "AVE N" rows,
  // since they're textually identical in site_address). None of the three
  // resolves it alone, but zip -> directional together do: chaining them
  // lets each one trim what the last one couldn't. A signal that would
  // narrow a candidate pool to zero (a data mismatch on that one field) is
  // skipped rather than applied, so one bad signal can't wrongly eliminate
  // every real candidate.
  let candidates = matches;
  const narrow = (predicate: (row: CountyParcelRow) => boolean) => {
    const filtered = candidates.filter(predicate);
    if (filtered.length > 0) candidates = filtered;
  };

  if (property.zipcode) narrow((row) => row.zipcode === property.zipcode);
  if (candidates.length > 1) {
    const suffixAbbrev = extractSuffixAbbreviation(property.street);
    if (suffixAbbrev) narrow((row) => row.str_sfx?.toLowerCase() === suffixAbbrev);
  }
  if (candidates.length > 1) {
    const directional = extractDirectional(property.street);
    if (directional) narrow((row) => extractParcelDirectional(row.site_address) === directional);
  }

  if (candidates.length === 1) return { parcel: candidates[0] ?? null };
  return { parcel: null, missReason: "ambiguous_match" };
}
