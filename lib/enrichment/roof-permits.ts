import { createServiceSupabase } from "@/lib/supabase/server";

/**
 * Year of the most recent qualifying roof permit for a parcel, from the
 * county_roof_permits table (scripts/sync-pinellas-permits.ts), or null if the
 * parcel has none on record.
 */
export async function findLatestRoofPermitYear(strap: string): Promise<number | null> {
  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("county_roof_permits")
    .select("roof_year")
    .eq("strap", strap)
    .maybeSingle();
  if (error) throw new Error(`Roof permit lookup failed: ${error.message}`);
  return data?.roof_year ?? null;
}

/**
 * Picks the roof year to store. A permit-derived year replaces a blank or
 * flat-default value, but never overwrites a newer year someone set from a
 * better source (e.g. a listing that states "2019 roof"). The default value
 * is recognized by equality, since nothing else marks it as a placeholder.
 */
export function resolveRoofYearFromPermit(
  existingRoofYear: number | null,
  permitYear: number,
  placeholderDefaultYear: number
): number {
  const existingIsRealAndNewer =
    existingRoofYear != null && existingRoofYear > permitYear && existingRoofYear !== placeholderDefaultYear;
  return existingIsRealAndNewer ? existingRoofYear : permitYear;
}
