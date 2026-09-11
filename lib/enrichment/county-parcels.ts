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
];

function normalizeStreetName(street: string): string {
  let words = street.trim().toLowerCase().split(/\s+/);
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

  return null;
}
