import { createServiceSupabase } from "@/lib/supabase/server";

const EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
};

export type BrandingKind = "photo" | "logo";

const BUCKET_BY_KIND: Record<BrandingKind, string> = {
  photo: "partner-photos",
  logo: "partner-logos",
};

export interface UploadPartnerImageResult {
  path: string;
}

/**
 * Uploads a referral partner's own co-branding headshot ("photo" — shown in
 * the co-branded block on generated proposal PDFs, see
 * lib/quote-requests/referral-partner.ts) or company logo ("logo" — shown
 * only in their own portal, never on a Brightway-generated PDF) and records
 * it on their industry_contacts row. `agencyId` must be the calling
 * partner's own agency — checked here, not just left to the caller, since
 * this runs with the service-role client (no RLS backstop).
 */
export async function uploadPartnerImage(kind: BrandingKind, agencyId: string, contactId: string, bytes: Uint8Array, contentType: string): Promise<UploadPartnerImageResult> {
  const extension = EXTENSION_BY_CONTENT_TYPE[contentType];
  if (!extension) {
    throw new Error(`Unsupported image type "${contentType}" — only JPEG and PNG are supported`);
  }

  const supabase = createServiceSupabase();
  const { data: contact, error: contactError } = await supabase.from("industry_contacts").select("agency_id").eq("id", contactId).single();
  if (contactError || !contact) {
    throw new Error(`Contact ${contactId} not found: ${contactError?.message ?? "no row"}`);
  }
  if (contact.agency_id !== agencyId) {
    throw new Error("That contact isn't in your agency.");
  }

  const bucket = BUCKET_BY_KIND[kind];

  // Same "replace, don't just upsert" handling as uploadAgentPhoto — upsert
  // alone wouldn't remove a file saved earlier under a different extension.
  const { data: existing } = await supabase.storage.from(bucket).list(`${agencyId}/${contactId}`);
  if (existing?.length) {
    await supabase.storage.from(bucket).remove(existing.map((f) => `${agencyId}/${contactId}/${f.name}`));
  }

  const path = `${agencyId}/${contactId}/${kind}.${extension}`;
  const { error: uploadError } = await supabase.storage.from(bucket).upload(path, bytes, { contentType, upsert: true });
  if (uploadError) throw new Error(`Failed to upload ${kind}: ${uploadError.message}`);

  const update = kind === "photo" ? { photo_path: path } : { logo_path: path };
  const { error: updateError } = await supabase.from("industry_contacts").update(update).eq("id", contactId);
  if (updateError) throw new Error(`Failed to record ${kind} on contact: ${updateError.message}`);

  return { path };
}
