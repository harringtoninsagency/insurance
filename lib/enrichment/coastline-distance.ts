import { createServiceSupabase } from "@/lib/supabase/server";

/**
 * Distance from a point to the nearest coastline, in miles. Computed locally
 * via PostGIS (public.coastline_distance_miles, migration 0019) against a
 * one-time bulk load of NOAA/USGS's medium-resolution US shoreline, filtered
 * to Florida (scripts/sync-florida-coastline.ts) — same bulk-download-once
 * approach already used for county parcel data, rather than a live distance
 * API.
 *
 * Returns null if florida_coastline hasn't been loaded yet (empty table), or
 * the point falls well outside Florida (the source dataset is filtered to a
 * Florida-plus-padding bounding box, not the full continental US).
 */
export async function distanceToCoastMiles(lat: number, lon: number): Promise<number | null> {
  const supabase = createServiceSupabase();
  const { data, error } = await supabase.rpc("coastline_distance_miles", { p_lon: lon, p_lat: lat });
  if (error) throw new Error(`Coastline distance lookup failed: ${error.message}`);
  // Round for display (the property page prints this raw, e.g. "0.12 mi") —
  // PostGIS returns full float precision, which is meaningless past ~0.01mi
  // given the source geometry is itself simplified to ~35m tolerance.
  return typeof data === "number" ? Math.round(data * 100) / 100 : null;
}
