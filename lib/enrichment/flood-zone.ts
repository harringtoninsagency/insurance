// FEMA's National Flood Hazard Layer (NFHL) — the actual regulatory source
// behind NFIP flood-zone determinations, queried live as a point-in-polygon
// lookup rather than synced in bulk: FIRM panels get revised piecemeal, and a
// live query always reflects the current effective map. No API key; public
// domain. Layer 28 ("Flood Hazard Zones") confirmed live against known
// Pinellas points: an inland point returns FLD_ZONE "X" (minimal hazard), a
// Clearwater Beach barrier-island point returns "VE" with a real base flood
// elevation.
// https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28

const NFHL_FLOOD_ZONES_LAYER = "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query";

export interface FloodZoneResult {
  /** FEMA's flood zone code, e.g. "AE", "VE", "X" — null if FEMA has no mapped data at this point (rare; usually a data gap, not "zero risk"). */
  zone: string | null;
  /** Special Flood Hazard Area — the high-risk designation mandatory flood insurance (on a federally backed mortgage) keys off. */
  specialFloodHazardArea: boolean | null;
  baseFloodElevationFt: number | null;
}

interface NfhlQueryResponse {
  features?: { attributes: { FLD_ZONE?: string; SFHA_TF?: string; STATIC_BFE?: number } }[];
  error?: { message?: string };
}

export async function lookupFloodZone(lat: number, lon: number): Promise<FloodZoneResult> {
  const url = new URL(NFHL_FLOOD_ZONES_LAYER);
  url.searchParams.set("geometry", `${lon},${lat}`);
  url.searchParams.set("geometryType", "esriGeometryPoint");
  url.searchParams.set("inSR", "4326");
  url.searchParams.set("spatialRel", "esriSpatialRelIntersects");
  url.searchParams.set("outFields", "FLD_ZONE,SFHA_TF,STATIC_BFE");
  url.searchParams.set("returnGeometry", "false");
  url.searchParams.set("f", "json");

  const res = await fetch(url);
  if (!res.ok) throw new Error(`FEMA NFHL query failed: HTTP ${res.status}`);
  const json = (await res.json()) as NfhlQueryResponse;
  if (json.error) throw new Error(`FEMA NFHL query failed: ${json.error.message}`);

  const attrs = json.features?.[0]?.attributes;
  if (!attrs) return { zone: null, specialFloodHazardArea: null, baseFloodElevationFt: null };

  // FEMA uses -9999 as "not applicable" rather than omitting the field.
  const bfe = attrs.STATIC_BFE;
  return {
    zone: attrs.FLD_ZONE ?? null,
    specialFloodHazardArea: attrs.SFHA_TF === "T" ? true : attrs.SFHA_TF === "F" ? false : null,
    baseFloodElevationFt: bfe != null && bfe > -9999 ? bfe : null,
  };
}
