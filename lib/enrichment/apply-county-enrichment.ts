import { createServiceSupabase } from "@/lib/supabase/server";
import { findCountyParcel } from "@/lib/enrichment/county-parcels";

// Maps PCPAO's free-text EXTERIOR_WALLS values to our own properties.construction
// vocabulary (which lib/adapters/fetch-quoting.ts then maps again into Fetch's
// construction_type_options). Distinct mapping direction/vocabulary from that
// file's CONSTRUCTION_TYPE_MAP — this one interprets the county's raw string.
function mapExteriorWallsToConstruction(exteriorWalls: string | null): string {
  const value = (exteriorWalls ?? "").toLowerCase();
  if (value.includes("frame") || value.includes("wood") || value.includes("siding") || value.includes("vinyl")) {
    return "Frame";
  }
  if (value.includes("veneer")) return "Masonry Veneer";
  return "Masonry";
}

export interface ApplyCountyEnrichmentResult {
  matched: boolean;
}

/**
 * Looks up a property's synced county_parcels record and, on a match, fills
 * in year_built/sqft/construction/parcel_id on `properties` and records an
 * audit row in `enrichments`. Does nothing on no match.
 */
export async function applyCountyEnrichment(propertyId: string): Promise<ApplyCountyEnrichmentResult> {
  const supabase = createServiceSupabase();

  const { data: property, error: propertyError } = await supabase
    .from("properties")
    .select("*")
    .eq("id", propertyId)
    .single();

  if (propertyError || !property) {
    throw new Error(`Property ${propertyId} not found: ${propertyError?.message ?? "no row"}`);
  }

  const parcel = await findCountyParcel(property);
  if (!parcel) return { matched: false };

  const { error: updateError } = await supabase
    .from("properties")
    .update({
      year_built: parcel.year_built ?? property.year_built,
      sqft: parcel.heated_area_sqft ?? property.sqft,
      construction: mapExteriorWallsToConstruction(parcel.exterior_walls),
      parcel_id: parcel.parcel_number ?? property.parcel_id,
      // Some ingest sources (the CSV export) don't carry a zip at all, and
      // Fetch's quote API requires one — backfill from the matched parcel
      // rather than clobbering a zip a more reliable source already set.
      zipcode: property.zipcode ?? parcel.zipcode ?? property.zipcode,
    })
    .eq("id", propertyId);

  if (updateError) {
    throw new Error(`Failed to update property ${propertyId}: ${updateError.message}`);
  }

  const { error: enrichmentError } = await supabase.from("enrichments").insert({
    agency_id: property.agency_id,
    property_id: propertyId,
    provider: "pcpao",
    county_appraiser_payload: parcel,
  });

  if (enrichmentError) {
    throw new Error(`Failed to record enrichment for ${propertyId}: ${enrichmentError.message}`);
  }

  return { matched: true };
}
