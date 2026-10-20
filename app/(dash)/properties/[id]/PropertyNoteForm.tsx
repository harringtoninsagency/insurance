"use client";

import { useState, useTransition } from "react";
import { recordPropertyNoteAction } from "./actions";

export function PropertyNoteForm({ propertyId }: { propertyId: string }) {
  const [note, setNote] = useState("");
  const [result, setResult] = useState<{ ok: true } | { ok: false; error: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await recordPropertyNoteAction(propertyId, note);
      setResult(res);
      if (res.ok) setNote("");
    });
  }

  return (
    <form onSubmit={submit} className="space-y-3 text-sm">
      <div className="space-y-1">
        <label htmlFor="property_note" className="text-xs text-slate-500">
          Add a note
        </label>
        <textarea
          id="property_note"
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. Seller wants to close before year end, roof was replaced in 2023"
          className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
        />
      </div>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="rounded border border-[#003049] px-3 py-1.5 font-medium text-[#003049] disabled:opacity-50"
        >
          {isPending ? "Saving..." : "Add note"}
        </button>
        {result && !result.ok && <span className="text-red-600">{result.error}</span>}
      </div>
    </form>
  );
}
