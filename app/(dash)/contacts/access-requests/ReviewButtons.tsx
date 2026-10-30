"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { approveAccessRequestAction, denyAccessRequestAction } from "./actions";

export function ReviewButtons({ requestId, fullName }: { requestId: string; fullName: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const approve = () => {
    if (!window.confirm(`Approve ${fullName}? This invites them into the partner portal.`)) return;
    startTransition(async () => {
      const result = await approveAccessRequestAction(requestId);
      if (result.ok) router.refresh();
      else setError(result.error);
    });
  };

  const deny = () => {
    const reason = window.prompt(`Deny ${fullName}'s request? Optionally say why (shown nowhere to them):`);
    if (reason === null) return;
    startTransition(async () => {
      const result = await denyAccessRequestAction(requestId, reason);
      if (result.ok) router.refresh();
      else setError(result.error);
    });
  };

  return (
    <div className="space-y-1">
      <div className="flex gap-2">
        <button
          type="button"
          disabled={isPending}
          onClick={approve}
          className="rounded bg-[#003049] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
        >
          Approve &amp; invite
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={deny}
          className="rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 disabled:opacity-50"
        >
          Deny
        </button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
