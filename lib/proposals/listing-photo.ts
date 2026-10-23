import { createServiceSupabase } from "@/lib/supabase/server";
import type { PhotoSource } from "@/lib/types/database";

const EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
};

export interface UploadListingPhotoResult {
  path: string;
}

/**
 * Uploads a listing photo — a producer-supplied one saved from the MLS/
 * listing site (source "manual"), one auto-extracted from a OneHome MLS
 * email (source "onehome"), or the NAIP aerial fallback
 * (lib/proposals/aerial-photo.ts, source "naip_aerial") — to the
 * listing-photos bucket and records it (and its source) on the property.
 * `source` drives generate-listing-snapshot.ts's "Aerial view" caption, so
 * a producer looking at the PDF can tell this isn't a real MLS photo yet.
 */
export async function uploadListingPhoto(
  propertyId: string,
  bytes: Uint8Array,
  contentType: string,
  source: PhotoSource = "manual"
): Promise<UploadListingPhotoResult> {
  const extension = EXTENSION_BY_CONTENT_TYPE[contentType];
  if (!extension) {
    throw new Error(`Unsupported photo type "${contentType}" — only JPEG and PNG are supported`);
  }

  const supabase = createServiceSupabase();
  const { data: property, error: propertyError } = await supabase
    .from("properties")
    .select("agency_id")
    .eq("id", propertyId)
    .single();
  if (propertyError || !property) {
    throw new Error(`Property ${propertyId} not found: ${propertyError?.message ?? "no row"}`);
  }

  const path = `${property.agency_id}/${propertyId}/photo.${extension}`;
  const { error: uploadError } = await supabase.storage
    .from("listing-photos")
    .upload(path, bytes, { contentType, upsert: true });
  if (uploadError) throw new Error(`Failed to upload listing photo: ${uploadError.message}`);

  const { error: updateError } = await supabase.from("properties").update({ photo_path: path, photo_source: source }).eq("id", propertyId);
  if (updateError) throw new Error(`Failed to record photo on property: ${updateError.message}`);

  return { path };
}
