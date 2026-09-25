import { createServiceSupabase } from "@/lib/supabase/server";
import type { ListingPhoto } from "@/lib/ingest/onehome-email";
import { uploadListingPhoto } from "@/lib/proposals/listing-photo";

export interface ApplyOneHomePhotosResult {
  attached: number;
  alreadyHadPhoto: number;
  noMatchingProperty: number;
  failed: number;
}

const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png"]);

/**
 * Downloads each listing photo linked in a OneHome email and stores it as the
 * property's listing photo. The links are the ones the sender embedded for
 * email clients to load, so they're fetched once at ingest and saved to our
 * own storage (they carry signed tokens and may expire). Never replaces a
 * photo a producer already uploaded.
 */
export async function applyOneHomePhotos(
  agencyId: string,
  photos: ListingPhoto[],
  options: { dryRun?: boolean } = {}
): Promise<ApplyOneHomePhotosResult> {
  const supabase = createServiceSupabase();
  const result: ApplyOneHomePhotosResult = { attached: 0, alreadyHadPhoto: 0, noMatchingProperty: 0, failed: 0 };

  for (const photo of photos) {
    const { data: property } = await supabase
      .from("properties")
      .select("id, photo_path")
      .eq("agency_id", agencyId)
      .eq("mls_id", photo.mlsId)
      .maybeSingle();

    if (!property) {
      result.noMatchingProperty += 1;
      continue;
    }
    if (property.photo_path) {
      result.alreadyHadPhoto += 1;
      continue;
    }
    if (options.dryRun) {
      result.attached += 1;
      continue;
    }

    try {
      const res = await fetch(photo.url, { headers: { "User-Agent": "Mozilla/5.0" } });
      const contentType = res.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
      if (!res.ok || !ACCEPTED_TYPES.has(contentType)) {
        console.warn(`Photo for ${photo.mlsId}: HTTP ${res.status}, type "${contentType}" — skipped`);
        result.failed += 1;
        continue;
      }
      await uploadListingPhoto(property.id, new Uint8Array(await res.arrayBuffer()), contentType);
      result.attached += 1;
    } catch (err) {
      console.warn(`Photo for ${photo.mlsId} failed:`, (err as Error).message);
      result.failed += 1;
    }
  }

  return result;
}
