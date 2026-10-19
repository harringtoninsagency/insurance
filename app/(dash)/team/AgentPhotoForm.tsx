"use client";

import { useState, useTransition } from "react";
import { setPersonalEmailAction, uploadAgentPhotoAction } from "./actions";
import type { TeamResult } from "@/lib/team/team";

// Next.js Server Actions cap the request body (next.config.ts raises it to
// 10MB) — enforced before uploadAgentPhotoAction ever runs, so an oversized
// file fails as an opaque framework error instead of a message this form can
// catch. Reject it here first, with room for multipart overhead.
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

export function AgentPhotoForm({
  memberId,
  photoUrl,
  personalEmail,
}: {
  memberId: string;
  photoUrl: string | null;
  personalEmail: string | null;
}) {
  const [isPhotoPending, startPhotoTransition] = useTransition();
  const [isEmailPending, startEmailTransition] = useTransition();
  const [photoMessage, setPhotoMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [emailMessage, setEmailMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  function runPhoto(formData: FormData) {
    const file = formData.get("photo");
    if (file instanceof File && file.size > MAX_PHOTO_BYTES) {
      setPhotoMessage({ tone: "error", text: `Photo is ${(file.size / 1024 / 1024).toFixed(1)}MB — please use one under 8MB.` });
      return;
    }
    setPhotoMessage(null);
    startPhotoTransition(async () => {
      const result: TeamResult = await uploadAgentPhotoAction(memberId, formData);
      setPhotoMessage(result.ok ? { tone: "ok", text: "Uploaded." } : { tone: "error", text: result.error });
    });
  }

  function runEmail(formData: FormData) {
    setEmailMessage(null);
    startEmailTransition(async () => {
      const result: TeamResult = await setPersonalEmailAction(memberId, formData);
      setEmailMessage(result.ok ? { tone: "ok", text: "Saved." } : { tone: "error", text: result.error });
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        {photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- a private, signed storage URL; next/image's remote-domain allowlist isn't worth it for a small admin table thumbnail.
          <img src={photoUrl} alt="" className="h-9 w-9 shrink-0 rounded-full border border-slate-200 object-cover" />
        ) : (
          <div className="h-9 w-9 shrink-0 rounded-full border border-dashed border-slate-300 bg-slate-50" />
        )}
        <form action={runPhoto} className="flex items-center gap-2">
          <input
            type="file"
            name="photo"
            accept="image/jpeg,image/png"
            required
            className="w-36 text-xs text-slate-600 file:mr-2 file:rounded file:border-0 file:bg-[#8291AC]/15 file:px-2 file:py-1 file:text-xs file:font-medium file:text-[#003049]"
          />
          <button
            type="submit"
            disabled={isPhotoPending}
            className="shrink-0 rounded border border-[#003049] px-2 py-1 text-xs font-medium text-[#003049] disabled:opacity-50"
          >
            {isPhotoPending ? "Uploading..." : "Upload"}
          </button>
        </form>
      </div>
      {photoMessage && <p className={`text-xs ${photoMessage.tone === "ok" ? "text-green-700" : "text-red-600"}`}>{photoMessage.text}</p>}

      <form action={runEmail} className="flex items-center gap-2">
        <input
          type="email"
          name="personal_email"
          placeholder="Personal email for proposals"
          defaultValue={personalEmail ?? ""}
          className="w-48 rounded border border-slate-300 px-2 py-1 text-xs"
        />
        <button
          type="submit"
          disabled={isEmailPending}
          className="shrink-0 rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {isEmailPending ? "Saving..." : "Save"}
        </button>
      </form>
      {emailMessage && <p className={`text-xs ${emailMessage.tone === "ok" ? "text-green-700" : "text-red-600"}`}>{emailMessage.text}</p>}
    </div>
  );
}
