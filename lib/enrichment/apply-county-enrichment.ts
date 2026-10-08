import { createServiceSupabase } from "@/lib/supabase/server";
import { findCountyParcel, type CountyParcelMissReason } from "@/lib/enrichment/county-parcels";
import { validateAddress } from "@/lib/address/usps-validate";
import { isBdrsCovered } from "@/lib/enrichment/building-jurisdiction";
import { findLatestRoofPermitYear, resolveRoofYearFromPermit } from "@/lib/enrichment/roof-permits";
import { lookupFloodZone } from "@/lib/enrichment/flood-zone";
import { distanceToCoastMiles } from "@/lib/enrichment/coastline-distance";

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
  missReason?: CountyParcelMissReason;
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

  // Confirm the address is real before spending a county-matching attempt on
  // it. Only acts on a confirmed "not found" — never on a USPS outage or
  // missing credentials, which come back as "error" and fall straight
  // through to matching as if this check hadn't run at all.
  if (property.house_number && property.street) {
    const usps = await validateAddress({
      streetAddress: `${property.house_number} ${property.street}`,
      city: property.city,
      state: property.state,
      zipCode: property.zipcode,
    });
    if (usps.status === "not_found") {
      return { matched: false, missReason: "usps_address_not_found" };
    }
    if (usps.status === "error") {
      console.warn(`USPS address validation skipped for ${propertyId}: ${usps.message}`);
    }
  }

  const { parcel, missReason } = await findCountyParcel(property);
  if (!parcel) return { matched: false, missReason };

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

  // Flood zone (live FEMA lookup) and distance to coast (local PostGIS calc)
  // both need the parcel's coordinates, which only Pinellas has today (see
  // scripts/sync-pinellas-parcel-coordinates.ts) — silently skipped for
  // anything else (e.g. Pasco) rather than failing the whole enrichment over
  // two supplementary fields. Same if either source itself errors (FEMA's
  // service is down, or scripts/sync-us-coastline.ts hasn't been run yet):
  // log it and move on, don't block enrichment on a nice-to-have.
  let floodZone: string | null = null;
  let distToCoastMiles: number | null = null;
  if (parcel.lat != null && parcel.lon != null) {
    try {
      floodZone = (await lookupFloodZone(parcel.lat, parcel.lon)).zone;
    } catch (err) {
      console.warn(`Flood zone lookup failed for ${propertyId}: ${(err as Error).message}`);
    }
    try {
      distToCoastMiles = await distanceToCoastMiles(parcel.lat, parcel.lon);
    } catch (err) {
      console.warn(`Coastline distance lookup failed for ${propertyId}: ${(err as Error).message}`);
    }
  }

  const { error: enrichmentError } = await supabase.from("enrichments").insert({
    agency_id: property.agency_id,
    property_id: propertyId,
    provider: parcel.county === "Pasco" ? "pascopa" : "pcpao",
    county_appraiser_payload: parcel,
    flood_zone: floodZone,
    dist_to_coast_miles: distToCoastMiles,
  });

  if (enrichmentError) {
    throw new Error(`Failed to record enrichment for ${propertyId}: ${enrichmentError.message}`);
  }

  return { matched: true };
}
