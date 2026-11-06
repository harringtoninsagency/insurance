"use client";

import { useState, useTransition } from "react";
import { formatDateOnly, formatDateOnlyEt } from "@/lib/dates";
import type { Database } from "@/lib/types/database";
import { stopQuoteRequestFollowUpsAction } from "./actions";

type FollowUpRow = Database["public"]["Tables"]["quote_request_follow_ups"]["Row"];

interface Props {
  requestId: string;
  followUps: FollowUpRow[];
}

/**
 * The two automated follow-up touches for a partner request (see
 * lib/quote-requests/follow-ups.ts) — one line per touch with where it
 * stands, and a "Stop" button while anything is still waiting to send.
 */
export function QuoteRequestFollowUps({ requestId, followUps }: Props) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [stopped, setStopped] = useState(false);

  if (!followUps.length) return <span className="text-xs text-slate-400">—</span>;

  const waiting = followUps.filter((f) => !f.sent_at && !f.stopped_at);
  const rows = [...followUps].sort((a, b) => a.touch - b.touch);

  function stop() {
    if (!confirm("Stop the remaining follow-up emails for this request?")) return;
    setError(null);
    startTransition(async () => {
      const result = await stopQuoteRequestFollowUpsAction(requestId);
      if (result.ok) setStopped(true);
      else setError(result.error);
    });
  }

  return (
    <div className="text-xs">
      {rows.map((f) => {
        const label = f.touch === 1 ? "Day 2 check-in" : "Day 7 close";
        let status: string;
        let className = "text-slate-500";
        if (f.sent_at) {
          status = `sent ${formatDateOnlyEt(f.sent_at)}`;
          className = "text-green-700";
        } else if (f.stopped_at || stopped) {
          status = "stopped";
          className = "text-slate-400";
        } else if (f.send_error) {
          status = `retrying (${f.send_error})`;
          className = "text-red-600";
        } else {
          status = `due ${formatDateOnly(f.scheduled_for)}`;
        }
        return (
          <div key={f.id} className={className} title={f.stopped_reason ?? f.send_error ?? undefined}>
            {label}: {status}
          </div>
        );
      })}
      {waiting.length > 0 && !stopped && (
        <button
          type="button"
          onClick={stop}
          disabled={isPending}
          className="mt-1 rounded border border-slate-300 px-2 py-0.5 text-xs text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50"
        >
          {isPending ? "Stopping..." : "Stop follow-ups"}
        </button>
      )}
      {error && <p className="mt-1 text-red-600">{error}</p>}
    </div>
  );
}
