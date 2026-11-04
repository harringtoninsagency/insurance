"use client";

import { useState, useTransition } from "react";
import { runQuoteForPropertyAction } from "./actions";
import type { QuoteRequestKind } from "@/lib/types/database";
import { FLOOD_QUOTING_ENABLED } from "@/lib/feature-flags";

export function RunQuoteButton({ propertyId, compact = false, label = "Run quote now" }: { propertyId: string; compact?: boolean; label?: string }) {
  const [isPending, startTransition] = useTransition();
  const [kind, setKind] = useState<QuoteRequestKind>("both");
  const [requestFloodQuote, setRequestFloodQuote] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  function run() {
    setMessage(null);
    startTransition(async () => {
      const result = await runQuoteForPropertyAction(propertyId, kind, requestFloodQuote);
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
        {!compact && FLOOD_QUOTING_ENABLED && (
          <label className="flex items-center gap-1.5 text-xs text-slate-700">
            <input
              type="checkbox"
              checked={requestFloodQuote}
              onChange={(e) => setRequestFloodQuote(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            Also quote flood (RocketFlood)
          </label>
        )}
        <button
          type="button"
          disabled={isPending}
          onClick={run}
          className={
            compact
              ? "rounded border border-[#003049] px-2.5 py-1 text-xs font-medium text-[#003049] hover:bg-[#003049]/5 disabled:opacity-50"
              : "rounded-full bg-[#F0FF00] px-3 py-1.5 text-sm font-bold text-[#003049] transition-colors hover:brightness-95 disabled:opacity-50"
          }
        >
          {isPending ? "Queuing..." : label}
        </button>
      </div>
      {message && <p className={`text-xs ${message.tone === "ok" ? "text-green-700" : "text-red-600"}`}>{message.text}</p>}
    </div>
  );
}
