"use client";

import { useActionState } from "react";
import { uploadListingPhotoAction } from "./actions";

type State = { uploaded: true } | { error: string } | null;

// Next.js Server Actions cap the request body (next.config.ts raises it to
// 10MB) — that cap is enforced before uploadListingPhotoAction ever runs, so
// an oversized file fails as an opaque framework error instead of a message
// this form can catch. Reject it here first, with room for multipart
// overhead, so the producer gets a clear reason instead of a cryptic one.
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

export function PhotoUploadForm({ propertyId }: { propertyId: string }) {
  async function runAction(_prev: State, formData: FormData): Promise<State> {
    const file = formData.get("photo");
    if (file instanceof File && file.size > MAX_PHOTO_BYTES) {
      return { error: `Photo is ${(file.size / 1024 / 1024).toFixed(1)}MB — please use one under 8MB.` };
    }
    try {
      await uploadListingPhotoAction(propertyId, formData);
      return { uploaded: true };
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Failed to upload photo" };
    }
  }

  const [state, formAction, isPending] = useActionState<State, FormData>(runAction, null);

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input
        type="file"
        name="photo"
        accept="image/jpeg,image/png"
        required
        className="text-sm text-slate-600 file:mr-3 file:rounded file:border-0 file:bg-[#8291AC]/15 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-[#003049]"
      />
      <button
        type="submit"
        disabled={isPending}
        className="rounded border border-[#003049] px-3 py-1.5 text-sm font-medium text-[#003049] disabled:opacity-50"
      >
        {isPending ? "Uploading..." : "Upload photo"}
      </button>
      {state && "uploaded" in state && <span className="text-sm text-slate-500">Uploaded.</span>}
      {state && "error" in state && <span className="text-sm text-red-600">{state.error}</span>}
    </form>
  );
}
