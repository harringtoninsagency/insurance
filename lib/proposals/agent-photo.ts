import { createServiceSupabase } from "@/lib/supabase/server";

const EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
};

export interface UploadAgentPhotoResult {
  path: string;
}

/**
 * Uploads a headshot for the "your agent" section of a generated proposal
 * PDF (see lib/quote-requests/proposal-agent.ts) to the agent-photos bucket
 * and records it on the agent's own profile. `agencyId` must be the calling
 * admin's own agency — checked here, not just left to the caller, since this
 * runs with the service-role client (no RLS backstop).
 */
export async function uploadAgentPhoto(agencyId: string, profileId: string, bytes: Uint8Array, contentType: string): Promise<UploadAgentPhotoResult> {
  const extension = EXTENSION_BY_CONTENT_TYPE[contentType];
  if (!extension) {
    throw new Error(`Unsupported photo type "${contentType}" — only JPEG and PNG are supported`);
  }

  const supabase = createServiceSupabase();
  const { data: profile, error: profileError } = await supabase.from("profiles").select("agency_id").eq("id", profileId).single();
  if (profileError || !profile) {
    throw new Error(`Team member ${profileId} not found: ${profileError?.message ?? "no row"}`);
  }
  if (profile.agency_id !== agencyId) {
    throw new Error("That team member isn't in your agency.");
  }

  // upsert: true alone isn't enough to replace a photo saved earlier under a
  // different extension (e.g. swapping a .png headshot for a .jpg one) — the
  // old file would just sit there unreferenced, so remove any existing
  // agent-photos object for this profile first.
  const { data: existing } = await supabase.storage.from("agent-photos").list(`${agencyId}/${profileId}`);
  if (existing?.length) {
    await supabase.storage.from("agent-photos").remove(existing.map((f) => `${agencyId}/${profileId}/${f.name}`));
  }

  const path = `${agencyId}/${profileId}/photo.${extension}`;
  const { error: uploadError } = await supabase.storage.from("agent-photos").upload(path, bytes, { contentType, upsert: true });
  if (uploadError) throw new Error(`Failed to upload agent photo: ${uploadError.message}`);

  const { error: updateError } = await supabase.from("profiles").update({ photo_path: path }).eq("id", profileId);
  if (updateError) throw new Error(`Failed to record photo on profile: ${updateError.message}`);

  return { path };
}
