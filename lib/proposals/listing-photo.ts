import { createServiceSupabase } from "@/lib/supabase/server";

const EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
};

export interface UploadListingPhotoResult {
  path: string;
}

/**
 * Uploads a producer-supplied listing photo (saved from the MLS/listing
 * site — there's no reliable automated source, see
 * lib/proposals/generate-listing-snapshot.ts) to the listing-photos bucket
 * and records it on the property.
 */
export async function uploadListingPhoto(
  propertyId: string,
  bytes: Uint8Array,
  contentType: string
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

  const { error: updateError } = await supabase.from("properties").update({ photo_path: path }).eq("id", propertyId);
  if (updateError) throw new Error(`Failed to record photo on property: ${updateError.message}`);

  return { path };
}
