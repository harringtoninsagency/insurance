"use client";

import { useState, useTransition } from "react";
import { updateManualCarrierAction } from "./actions";

export function ManualCarrierForm({ propertyId, name, premium }: { propertyId: string; name: string | null; premium: number | null }) {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  return (
    <form
      className="flex flex-wrap items-end gap-3"
      action={(formData) => {
        setMessage(null);
        startTransition(async () => {
          const result = await updateManualCarrierAction(propertyId, formData);
          setMessage(result.ok ? { tone: "ok", text: "Saved." } : { tone: "error", text: result.error });
        });
      }}
    >
      <div className="space-y-1">
        <label htmlFor="manual_carrier_name" className="text-xs text-slate-500">
          Carrier name
        </label>
        <input
          id="manual_carrier_name"
          name="manual_carrier_name"
          type="text"
          placeholder="e.g. Citizens"
          defaultValue={name ?? ""}
          className="rounded border border-slate-300 px-2 py-1.5 text-sm"
        />
      </div>
      <div className="space-y-1">
        <label htmlFor="manual_carrier_premium" className="text-xs text-slate-500">
          Annual premium
        </label>
        <input
          id="manual_carrier_premium"
          name="manual_carrier_premium"
          type="number"
          min="0"
          step="1"
          placeholder="3200"
          defaultValue={premium ?? ""}
          className="rounded border border-slate-300 px-2 py-1.5 text-sm"
        />
      </div>
      <button type="submit" disabled={isPending} className="rounded border border-[#003049] px-3 py-1.5 text-sm font-medium text-[#003049] disabled:opacity-50">
        {isPending ? "Saving..." : "Save"}
      </button>
      {message && <span className={`text-sm ${message.tone === "ok" ? "text-green-700" : "text-red-600"}`}>{message.text}</span>}
      <p className="w-full text-xs text-slate-500">
        Fills the 5th, customizable row of the listing snapshot&apos;s carrier table — for a company checked by hand that
        didn&apos;t pull a result through Fetch. Leave blank to show it as empty.
      </p>
    </form>
  );
}
