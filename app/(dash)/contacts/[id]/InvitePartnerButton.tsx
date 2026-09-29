"use client";

import { useState, useTransition } from "react";
import { invitePartnerAction } from "../actions";

export function InvitePartnerButton({ contactId, hasEmail }: { contactId: string; hasEmail: boolean }) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: true } | { ok: false; error: string } | null>(null);

  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={isPending || !hasEmail}
        onClick={() => startTransition(async () => setResult(await invitePartnerAction(contactId)))}
        className="rounded border border-[#003049] px-3 py-1.5 text-sm font-medium text-[#003049] disabled:opacity-50"
        title={hasEmail ? undefined : "Add an email address first"}
      >
        {isPending ? "Sending invite..." : "Invite to partner portal"}
      </button>
      {result?.ok && <p className="text-sm text-green-700">Invite sent.</p>}
      {result && !result.ok && <p className="text-sm text-red-600">{result.error}</p>}
    </div>
  );
}
