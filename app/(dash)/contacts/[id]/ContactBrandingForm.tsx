"use client";

import { useActionState, useState } from "react";
import { uploadContactPhotoAction, uploadContactLogoAction, type ContactBrandingResult } from "../actions";

// Same cap as the partner portal's own BrandingForm — Next.js server actions
// cap the request body (next.config.ts raises it to 10MB), enforced before
// the action ever runs, so an oversized file otherwise fails as an opaque
// framework error instead of a message this form can catch.
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

function ImageUploadRow({
  kind,
  label,
  imageUrl,
  action,
}: {
  kind: "photo" | "logo";
  label: string;
  imageUrl: string | null;
  action: (prev: ContactBrandingResult | null, formData: FormData) => Promise<ContactBrandingResult>;
}) {
  const [state, formAction, isPending] = useActionState<ContactBrandingResult | null, FormData>(action, null);
  const [sizeError, setSizeError] = useState<string | null>(null);

  function runAction(formData: FormData) {
    const file = formData.get(kind);
    if (file instanceof File && file.size > MAX_IMAGE_BYTES) {
      setSizeError(`That file is ${(file.size / 1024 / 1024).toFixed(1)}MB — please use one under 8MB.`);
      return;
    }
    setSizeError(null);
    formAction(formData);
  }

  return (
    <div className="flex items-center gap-3">
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- a private, signed storage URL; next/image's remote-domain allowlist isn't worth it for a small admin thumbnail.
        <img src={imageUrl} alt="" className={`h-12 w-12 shrink-0 border border-slate-200 object-contain ${kind === "photo" ? "rounded-full" : "rounded bg-white p-1"}`} />
      ) : (
        <div className={`h-12 w-12 shrink-0 border border-dashed border-slate-300 bg-slate-50 ${kind === "photo" ? "rounded-full" : "rounded"}`} />
      )}
      <form action={runAction} className="flex flex-1 flex-wrap items-center gap-2">
        <label className="text-xs text-slate-500">{label}</label>
        <input
          type="file"
          name={kind}
          accept="image/jpeg,image/png"
          required
          className="w-44 text-xs text-slate-600 file:mr-2 file:rounded file:border-0 file:bg-[#8291AC]/15 file:px-2 file:py-1 file:text-xs file:font-medium file:text-[#003049]"
        />
        <button
          type="submit"
          disabled={isPending}
          className="shrink-0 rounded border border-[#003049] px-2 py-1 text-xs font-medium text-[#003049] disabled:opacity-50"
        >
          {isPending ? "Uploading..." : "Upload"}
        </button>
      </form>
      {(sizeError || (state && !state.ok)) && <p className="w-full text-xs text-red-600">{sizeError ?? (state as { ok: false; error: string }).error}</p>}
      {state?.ok && <p className="w-full text-xs text-green-700">Uploaded.</p>}
    </div>
  );
}

export function ContactBrandingForm({ contactId, photoUrl, logoUrl }: { contactId: string; photoUrl: string | null; logoUrl: string | null }) {
  const photoAction = (prev: ContactBrandingResult | null, formData: FormData) => uploadContactPhotoAction(contactId, prev, formData);
  const logoAction = (prev: ContactBrandingResult | null, formData: FormData) => uploadContactLogoAction(contactId, prev, formData);

  return (
    <div className="space-y-3">
      <ImageUploadRow
        kind="photo"
        label="Co-branding photo — appears alongside their contact info on generated insurance summary and listing snapshot PDFs"
        imageUrl={photoUrl}
        action={photoAction}
      />
      <ImageUploadRow kind="logo" label="Company logo — shown in their own portal only, not on PDFs" imageUrl={logoUrl} action={logoAction} />
    </div>
  );
}
