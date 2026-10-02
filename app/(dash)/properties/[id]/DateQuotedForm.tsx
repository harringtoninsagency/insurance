"use client";

import { useState, useTransition } from "react";
import { updateDateQuotedAction } from "./actions";

export function DateQuotedForm({ propertyId, value }: { propertyId: string; value: string | null }) {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  return (
    <form
      className="flex flex-wrap items-end gap-3"
      action={(formData) => {
        setMessage(null);
        startTransition(async () => {
          const result = await updateDateQuotedAction(propertyId, formData);
          setMessage(result.ok ? { tone: "ok", text: "Saved." } : { tone: "error", text: result.error });
        });
      }}
    >
      <div className="space-y-1">
        <label htmlFor="date_quoted" className="text-xs text-slate-500">
          Date quoted
        </label>
        <input id="date_quoted" name="date_quoted" type="date" defaultValue={value ?? ""} className="rounded border border-slate-300 px-2 py-1.5 text-sm" />
      </div>
      <button type="submit" disabled={isPending} className="rounded border border-[#003049] px-3 py-1.5 text-sm font-medium text-[#003049] disabled:opacity-50">
        {isPending ? "Saving..." : "Save"}
      </button>
      {message && <span className={`text-sm ${message.tone === "ok" ? "text-green-700" : "text-red-600"}`}>{message.text}</span>}
      <p className="w-full text-xs text-slate-500">Defaults to the date a quote was submitted; change it if you quoted on a different day.</p>
    </form>
  );
}
