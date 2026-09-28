"use client";

import { useState, useTransition } from "react";
import { sendAllApprovedAction, sendOutreachAction, type SendActionResult } from "./actions";

function useSend() {
  const [result, setResult] = useState<SendActionResult | null>(null);
  const [isPending, startTransition] = useTransition();
  const run = (fn: () => Promise<SendActionResult>) => startTransition(async () => setResult(await fn()));
  return { result, isPending, run };
}

function Result({ result }: { result: SendActionResult | null }) {
  if (!result) return null;
  return result.ok ? (
    <span className="text-xs text-slate-600">{result.message}</span>
  ) : (
    <span className="text-xs text-red-600">{result.error}</span>
  );
}

export function SendOneButton({ outreachId, disabled }: { outreachId: string; disabled: boolean }) {
  const { result, isPending, run } = useSend();
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={disabled || isPending}
        onClick={() => run(() => sendOutreachAction(outreachId))}
        className="rounded bg-[#003049] px-3 py-1.5 text-white transition-colors hover:bg-[#012333] disabled:opacity-40"
      >
        {isPending ? "Sending..." : "Send"}
      </button>
      <Result result={result} />
    </div>
  );
}

export function SendAllButton({ count, disabled }: { count: number; disabled: boolean }) {
  const { result, isPending, run } = useSend();
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        disabled={disabled || isPending}
        onClick={() => {
          if (window.confirm(`Send ${Math.min(count, 25)} approved email${count === 1 ? "" : "s"} now?`)) run(sendAllApprovedAction);
        }}
        className="rounded bg-[#003049] px-3 py-1.5 text-sm text-white transition-colors hover:bg-[#012333] disabled:opacity-40"
      >
        {isPending ? "Sending..." : `Send all approved (${Math.min(count, 25)})`}
      </button>
      <Result result={result} />
    </div>
  );
}
