"use client";

import { useState, useTransition } from "react";
import { runQuoteForPropertyAction } from "./actions";
import type { QuoteRequestKind } from "@/lib/types/database";

export function RunQuoteButton({ propertyId, compact = false, label = "Run quote now" }: { propertyId: string; compact?: boolean; label?: string }) {
  const [isPending, startTransition] = useTransition();
  const [kind, setKind] = useState<QuoteRequestKind>("both");
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  function run() {
    setMessage(null);
    startTransition(async () => {
      const result = await runQuoteForPropertyAction(propertyId, kind);
      setMessage(
        result.ok
          ? {
              tone: "ok",
              text: result.alreadyQueued
                ? result.started
                  ? "Already queued — quote run started."
                  : "Already queued."
                : result.started
                  ? "Started — quotes usually appear in a few minutes."
                  : "Queued — quotes will appear after the next run.",
            }
          : { tone: "error", text: result.error }
      );
    });
  }

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        {!compact && (
          <select
            aria-label="What to produce"
            value={kind}
            onChange={(e) => setKind(e.target.value as QuoteRequestKind)}
            className="rounded border border-slate-300 bg-white px-2 py-1.5 text-sm"
          >
            <option value="both">Quote summary + listing snapshot</option>
            <option value="quote_summary">Quote summary only</option>
            <option value="listing_snapshot">Listing snapshot only</option>
          </select>
        )}
        <button
          type="button"
          disabled={isPending}
          onClick={run}
          className={
            compact
              ? "rounded border border-[#003049] px-2.5 py-1 text-xs font-medium text-[#003049] hover:bg-[#003049]/5 disabled:opacity-50"
              : "rounded bg-[#003049] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
          }
        >
          {isPending ? "Queuing..." : label}
        </button>
      </div>
      {message && <p className={`text-xs ${message.tone === "ok" ? "text-green-700" : "text-red-600"}`}>{message.text}</p>}
    </div>
  );
}
