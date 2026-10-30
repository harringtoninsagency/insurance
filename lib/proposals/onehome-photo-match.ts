import { createServiceSupabase } from "@/lib/supabase/server";
import { normalizeStreetName } from "@/lib/enrichment/county-parcels";

export type OneHomePhotoMatchResult =
  | { status: "attached"; fromPropertyId: string; replaced: "none" | "naip_aerial" }
  | { status: "kept_existing" }
  | { status: "no_match" }
  | { status: "skipped"; reason: string };

/**
 * When a quote request comes in for a home that's currently listed, the
 * OneHome ingest (daily email + the onehome-photos skill's portal scrape)
 * has very likely already created a sibling `properties` row for that same
 * address with the MLS front-of-home photo. This copies that photo onto the
 * quote-request property so its Insurance Summary / Listing Snapshot PDFs
 * show the real house instead of the NAIP aerial fallback.
 *
 * Match rule: same agency, source 'onehome', photo_source 'onehome', same
 * house number (case-insensitive) and the same normalized street name
 * (lib/enrichment/county-parcels.ts's normalizeStreetName — suffixes and
 * directionals stripped, same rule the county matcher uses), and the same
 * ZIP when both sides have one (falls back to city when either is missing).
 *
 * Replaces an auto-fetched NAIP aerial (a real photo always beats it) but
 * never a manually uploaded photo or one already sourced from OneHome.
 * Best-effort: never throws, so it can sit inline in the request pipeline.
 */
export async function attachOneHomePhotoIfListed(propertyId: string): Promise<OneHomePhotoMatchResult> {
  try {
    const supabase = createServiceSupabase();
    const { data: property } = await supabase
      .from("properties")
      .select("id, agency_id, house_number, street, city, zipcode, photo_path, photo_source")
      .eq("id", propertyId)
      .maybeSingle();
    if (!property) return { status: "skipped", reason: "property not found" };
    if (property.photo_path && property.photo_source !== "naip_aerial") return { status: "kept_existing" };
    if (!property.house_number || !property.street) return { status: "skipped", reason: "no structured address" };

    const streetKey = normalizeStreetName(property.street);
    const { data: candidates } = await supabase
      .from("properties")
      .select("id, street, city, zipcode, photo_path")
      .eq("agency_id", property.agency_id)
      .eq("source", "onehome")
      .eq("photo_source", "onehome")
      .not("photo_path", "is", null)
      .ilike("house_number", property.house_number)
      .neq("id", property.id);

    const match = (candidates ?? []).find((c) => {
      if (!c.street || normalizeStreetName(c.street) !== streetKey) return false;
      if (property.zipcode && c.zipcode) return property.zipcode.slice(0, 5) === c.zipcode.slice(0, 5);
      return (c.city ?? "").trim().toLowerCase() === (property.city ?? "").trim().toLowerCase();
    });
    if (!match?.photo_path) return { status: "no_match" };

    const extension = match.photo_path.split(".").pop() ?? "jpg";
    const destination = `${property.agency_id}/${property.id}/photo.${extension}`;
    // Storage copy refuses to overwrite, and a replaced aerial may already sit at this path.
    await supabase.storage.from("listing-photos").remove([destination]);
    const { error: copyError } = await supabase.storage.from("listing-photos").copy(match.photo_path, destination);
    if (copyError) return { status: "skipped", reason: `copy failed: ${copyError.message}` };

    const { error: updateError } = await supabase
      .from("properties")
      .update({ photo_path: destination, photo_source: "onehome" })
      .eq("id", property.id);
    if (updateError) return { status: "skipped", reason: `update failed: ${updateError.message}` };

    return { status: "attached", fromPropertyId: match.id, replaced: property.photo_source === "naip_aerial" ? "naip_aerial" : "none" };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn(`OneHome photo match failed for property ${propertyId}: ${reason}`);
    return { status: "skipped", reason };
  }
}
