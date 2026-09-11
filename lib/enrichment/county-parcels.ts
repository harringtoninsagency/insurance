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
  let words = stripUnitDesignator(street).trim().toLowerCase().split(/\s+/);
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
const SUFFIX_ABBREVIATIONS: Record<string, string> = {
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

/**
 * Matches a property to a synced county_parcels row by street number + name
 * (+ zip as a confidence check). Returns null rather than guessing on zero or
 * multiple matches — ambiguity needs a human, not a silent wrong pick.
 */
export async function findCountyParcel(property: PropertyRow): Promise<CountyParcelRow | null> {
  if (!property.house_number || !property.street) return null;

  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("county_parcels")
    .select("*")
    .eq("str_num", property.house_number);

  if (error) throw new Error(`County parcel lookup failed: ${error.message}`);
  if (!data?.length) return null;

  const targetStreet = normalizeStreetName(property.street);
  const matches = data.filter((row) => row.str_name && normalizeStreetName(row.str_name) === targetStreet);

  if (matches.length === 1) return matches[0] ?? null;

  if (matches.length > 1 && property.zipcode) {
    const zipMatches = matches.filter((row) => row.zipcode === property.zipcode);
    if (zipMatches.length === 1) return zipMatches[0] ?? null;
  }

  if (matches.length > 1) {
    const suffixAbbrev = extractSuffixAbbreviation(property.street);
    if (suffixAbbrev) {
      const suffixMatches = matches.filter((row) => row.str_sfx?.toLowerCase() === suffixAbbrev);
      if (suffixMatches.length === 1) return suffixMatches[0] ?? null;
    }
  }

  if (matches.length > 1) {
    const directional = extractDirectional(property.street);
    if (directional) {
      const directionalMatches = matches.filter(
        (row) => extractParcelDirectional(row.site_address) === directional
      );
      if (directionalMatches.length === 1) return directionalMatches[0] ?? null;
    }
  }

  return null;
}
