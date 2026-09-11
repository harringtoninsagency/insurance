"use client";

import { useActionState } from "react";
import { uploadListingPhotoAction } from "./actions";

type State = { uploaded: true } | { error: string } | null;

export function PhotoUploadForm({ propertyId }: { propertyId: string }) {
  async function runAction(_prev: State, formData: FormData): Promise<State> {
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
