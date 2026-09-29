import { createServiceSupabase } from "@/lib/supabase/server";
import { findCountyParcel } from "@/lib/enrichment/county-parcels";
import { isBdrsCovered } from "@/lib/enrichment/building-jurisdiction";
import { findLatestRoofPermitYear, resolveRoofYearFromPermit } from "@/lib/enrichment/roof-permits";

// Placeholder for parcels with no roof permit on record, outside BDRS
// coverage (their own building departments aren't reachable through the
// Access Portal scraper in scripts/backfill-roof-years.ts). Rather than leave
// roof_year blank (which falls back to year_built at quote time — treating
// every such home as if its roof has never been replaced), assume a mid-life
// roof as a rough planning default.
const NON_BDRS_DEFAULT_ROOF_AGE_YEARS = 10;

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

  // Real permit history first (county_roof_permits, synced from PCPAO's
  // countywide permit export). With no roof permit on record, fall back to the
  // earlier rules: BDRS-covered properties keep roof_year as-is (null means
  // "assume original roof" at quote time), everything else gets the flat
  // default.
  const placeholderDefaultYear = new Date().getFullYear() - NON_BDRS_DEFAULT_ROOF_AGE_YEARS;
  const permitYear = await findLatestRoofPermitYear(parcel.strap);
  const roofYear =
    permitYear != null
      ? resolveRoofYearFromPermit(property.roof_year, permitYear, placeholderDefaultYear)
      : isBdrsCovered(property.city)
        ? property.roof_year
        : (property.roof_year ?? placeholderDefaultYear);

  const enrichedFields = {
    year_built: parcel.year_built ?? property.year_built,
    sqft: parcel.heated_area_sqft ?? property.sqft,
    construction: mapExteriorWallsToConstruction(parcel.exterior_walls),
    parcel_id: parcel.parcel_number ?? property.parcel_id,
    // Some ingest sources (the CSV export) don't carry a zip at all, and
    // Fetch's quote API requires one — backfill from the matched parcel
    // rather than clobbering a zip a more reliable source already set.
    zipcode: property.zipcode ?? parcel.zipcode ?? property.zipcode,
    roof_year: roofYear,
  };

  const { error: updateError } = await supabase.from("properties").update(enrichedFields).eq("id", propertyId);

  if (updateError) {
    // Two property rows can legitimately point at the same physical parcel
    // now that quote requests always get their own dedicated row (see
    // lib/quote-requests/prepare.ts) rather than reusing one already on file
    // for that address — `unique(agency_id, parcel_id)` then refuses the
    // second one. parcel_id is bookkeeping only; nothing downstream (Fetch
    // quoting, proposals) reads it, so on that specific collision, save
    // everything else and simply leave this row's parcel_id blank.
    const isParcelIdCollision = updateError.code === "23505" && updateError.message.includes("parcel_id");
    if (!isParcelIdCollision) {
      throw new Error(`Failed to update property ${propertyId}: ${updateError.message}`);
    }
    const { error: retryError } = await supabase
      .from("properties")
      .update({ ...enrichedFields, parcel_id: property.parcel_id })
      .eq("id", propertyId);
    if (retryError) {
      throw new Error(`Failed to update property ${propertyId}: ${retryError.message}`);
    }
  }

  const { error: enrichmentError } = await supabase.from("enrichments").insert({
    agency_id: property.agency_id,
    property_id: propertyId,
    provider: parcel.county === "Pasco" ? "pascopa" : "pcpao",
    county_appraiser_payload: parcel,
  });

  if (enrichmentError) {
    throw new Error(`Failed to record enrichment for ${propertyId}: ${enrichmentError.message}`);
  }

  return { matched: true };
}
