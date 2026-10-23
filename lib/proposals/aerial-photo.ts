import { createServiceSupabase } from "@/lib/supabase/server";
import { uploadListingPhoto } from "@/lib/proposals/listing-photo";

const NAIP_EXPORT_URL = "https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/exportImage";
// Half-width of the fetched image's real-world footprint, in meters — a
// 70m x 70m box. Confirmed visually against several real Pinellas County
// properties: tight enough to center on one house and its own lot (driveway,
// pool, roofline all legible), wide enough to still show yard/street
// context rather than just a close-up of the roof.
const HALF_WIDTH_METERS = 35;
const IMAGE_SIZE = "800,600";

/** Converts WGS84 lat/lon to the Web Mercator (EPSG:3857) coordinates NAIP's ArcGIS ImageServer expects for its bbox parameter. */
function toWebMercator(lat: number, lon: number): { x: number; y: number } {
  const EARTH_RADIUS = 20037508.34;
  const x = (lon * EARTH_RADIUS) / 180;
  const y = (Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) / (Math.PI / 180)) * (EARTH_RADIUS / 180);
  return { x, y };
}

/**
 * Fetches a straight-down aerial photo centered on a lat/lon from USGS's
 * public NAIP (National Agriculture Imagery Program) ImageServer — a
 * genuine US federal government work, public domain under 17 U.S.C. § 105,
 * no API key and no usage restriction (confirmed against the service's own
 * metadata: `copyrightText: "USGS, USDA, The National Map: Orthoimagery"`,
 * `allowCopy: true`). Typical resolution ~0.3–0.6m/pixel — a house,
 * driveway, and pool are clearly recognizable at the crop used here, though
 * it reads as a straight-down aerial/map view, not a street-level "curb
 * appeal" photo the way an MLS listing photo does.
 *
 * Returns null (never throws) on any failure — a missing fallback photo is
 * never worth blocking enrichment or a quote over.
 */
export async function fetchAerialPhoto(lat: number, lon: number): Promise<Uint8Array | null> {
  try {
    const { x, y } = toWebMercator(lat, lon);
    const bbox = [x - HALF_WIDTH_METERS, y - HALF_WIDTH_METERS, x + HALF_WIDTH_METERS, y + HALF_WIDTH_METERS].join(",");
    const url = `${NAIP_EXPORT_URL}?bbox=${bbox}&bboxSR=102100&imageSR=102100&size=${IMAGE_SIZE}&format=jpg&f=image`;
    const res = await fetch(url);
    if (!res.ok) return null;
    // A bbox outside NAIP's coverage (or any server-side error) comes back
    // as a 200 with a JSON error body, not a non-2xx status — Esri's REST
    // convention for this kind of service. Only trust an actual image.
    if (!(res.headers.get("content-type") ?? "").startsWith("image/")) return null;
    return new Uint8Array(await res.arrayBuffer());
  } catch (err) {
    console.warn(`NAIP aerial photo fetch failed for (${lat}, ${lon}): ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

/**
 * Fills in a property's listing photo from NAIP when nothing else has
 * supplied one yet — no OneHome-extracted MLS photo, no manual upload (see
 * lib/proposals/listing-photo.ts's own doc comment for the two real
 * sources). Only acts when `photo_path` is still empty at call time, so a
 * real photo — uploaded or ingested before or after this runs — always
 * wins; this never overwrites one. Called from
 * lib/enrichment/apply-county-enrichment.ts, which is the only place a
 * property's lat/lon is available (Pinellas County parcels only, today).
 */
export async function attachAerialPhotoFallback(propertyId: string, lat: number, lon: number): Promise<void> {
  try {
    const supabase = createServiceSupabase();
    const { data: property } = await supabase.from("properties").select("photo_path").eq("id", propertyId).maybeSingle();
    if (property?.photo_path) return;

    const bytes = await fetchAerialPhoto(lat, lon);
    if (!bytes) return;

    await uploadListingPhoto(propertyId, bytes, "image/jpeg", "naip_aerial");
  } catch (err) {
    console.warn(`Failed to attach NAIP aerial fallback photo for property ${propertyId}: ${err instanceof Error ? err.message : err}`);
  }
}
