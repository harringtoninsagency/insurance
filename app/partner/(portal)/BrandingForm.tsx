"use client";

import { useState, useActionState } from "react";
import { uploadPartnerPhotoAction, uploadPartnerLogoAction, updatePartnerAgentAction, type PartnerActionResult } from "./actions";

// Same cap as AgentPhotoForm/PhotoUploadForm — Next.js server actions cap
// the request body (next.config.ts raises it to 10MB), enforced before the
// action ever runs, so an oversized file otherwise fails as an opaque
// framework error instead of a message this form can catch.
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

interface Agent {
  id: string;
  fullName: string | null;
  email: string;
}

function ImageUploadRow({
  kind,
  label,
  imageUrl,
  action,
}: {
  kind: "photo" | "logo";
  label: string;
  imageUrl: string | null;
  action: (prev: PartnerActionResult | null, formData: FormData) => Promise<PartnerActionResult>;
}) {
  const [state, formAction, isPending] = useActionState<PartnerActionResult | null, FormData>(action, null);
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
        // eslint-disable-next-line @next/next/no-img-element -- a private, signed storage URL; next/image's remote-domain allowlist isn't worth it for a small portal thumbnail.
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

export function BrandingForm({
  photoUrl,
  logoUrl,
  referralPartnerAgentId,
  agents,
}: {
  photoUrl: string | null;
  logoUrl: string | null;
  referralPartnerAgentId: string | null;
  agents: Agent[];
}) {
  const [agentState, agentFormAction, isAgentPending] = useActionState<PartnerActionResult | null, FormData>(updatePartnerAgentAction, null);

  return (
    <details className="rounded-lg border border-slate-200 bg-white p-5">
      <summary className="cursor-pointer font-medium text-[#003049]">Your co-branding &amp; Brightway agent</summary>
      <div className="mt-4 space-y-4 text-sm">
        <ImageUploadRow
          kind="photo"
          label="Your photo — appears alongside your contact info on Brightway-generated insurance summary and listing snapshot PDFs"
          imageUrl={photoUrl}
          action={uploadPartnerPhotoAction}
        />
        <ImageUploadRow
          kind="logo"
          label="Your company logo — shown here in your portal only, not on Brightway's PDFs"
          imageUrl={logoUrl}
          action={uploadPartnerLogoAction}
        />

        <div className="space-y-1 border-t border-slate-200 pt-4">
          <label htmlFor="referral_partner_agent_id" className="text-xs text-slate-500">
            Your Brightway agent — shown alongside your own info on every proposal, and who gets CC&apos;d on your results
          </label>
          <form action={agentFormAction}>
            <select
              id="referral_partner_agent_id"
              name="referral_partner_agent_id"
              defaultValue={referralPartnerAgentId ?? ""}
              onChange={(e) => e.currentTarget.form?.requestSubmit()}
              disabled={isAgentPending}
              className="w-full max-w-sm rounded border border-slate-300 bg-white px-2 py-1.5 text-sm disabled:opacity-50"
            >
              <option value="">— None selected —</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.fullName ?? a.email}
                </option>
              ))}
            </select>
          </form>
          {agentState && !agentState.ok && <p className="mt-1 text-xs text-red-600">{agentState.error}</p>}
          {agentState?.ok && <p className="mt-1 text-xs text-green-700">Saved.</p>}
        </div>
      </div>
    </details>
  );
}
