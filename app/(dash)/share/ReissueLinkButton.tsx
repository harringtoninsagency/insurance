"use client";

import { useState, useTransition } from "react";
import { reissueAgentLinkAction } from "./actions";

export function ReissueLinkButton({ agentId }: { agentId: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const reissue = () => {
    if (!window.confirm("Kill this agent's current link and issue a new one? The old link (and any QR code or graphic using it) stops working immediately.")) return;
    startTransition(async () => {
      const result = await reissueAgentLinkAction(agentId);
      setError(result.ok ? null : result.error);
    });
  };

  return (
    <div className="shrink-0 text-right">
      <button
        type="button"
        disabled={isPending}
        onClick={reissue}
        className="rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-600 disabled:opacity-50"
      >
        {isPending ? "Reissuing..." : "Revoke & reissue link"}
      </button>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
