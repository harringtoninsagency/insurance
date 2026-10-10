"use client";

import { useState, useTransition } from "react";
import { recordFollowUpAction } from "../actions";

const inputClass = "w-full rounded border border-slate-300 px-2 py-1.5 text-sm";

export function FollowUpForm({ contactId }: { contactId: string }) {
  const [note, setNote] = useState("");
  const [nextFollowUpOn, setNextFollowUpOn] = useState("");
  const [result, setResult] = useState<{ ok: true } | { ok: false; error: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await recordFollowUpAction(contactId, { note, nextFollowUpOn });
      setResult(res);
      if (res.ok) {
        setNote("");
        setNextFollowUpOn("");
      }
    });
  }

  return (
    <form onSubmit={submit} className="space-y-3 text-sm">
      <div className="space-y-1">
        <label htmlFor="follow_up_note" className="text-xs text-slate-500">
          What happened / what&apos;s next
        </label>
        <textarea
          id="follow_up_note"
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. Called to check in, they have 2 closings coming up in November"
          className={inputClass}
        />
      </div>
      <div className="w-48 space-y-1">
        <label htmlFor="next_follow_up_on" className="text-xs text-slate-500">
          Next follow-up date (optional)
        </label>
        <input
          id="next_follow_up_on"
          type="date"
          value={nextFollowUpOn}
          onChange={(e) => setNextFollowUpOn(e.target.value)}
          className={inputClass}
        />
      </div>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="rounded border border-[#003049] px-3 py-1.5 font-medium text-[#003049] disabled:opacity-50"
        >
          {isPending ? "Saving..." : "Add follow-up"}
        </button>
        {result && !result.ok && <span className="text-red-600">{result.error}</span>}
      </div>
    </form>
  );
}
