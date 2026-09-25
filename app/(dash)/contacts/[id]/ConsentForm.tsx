"use client";

import { useState, useTransition } from "react";
import { recordConsentAction } from "../actions";
import type { ConsentEventType, ConsentMethod } from "@/lib/types/database";

const inputClass = "w-full rounded border border-slate-300 px-2 py-1.5 text-sm";

const KINDS: Array<{ value: ConsentEventType; label: string; hint: string }> = [
  { value: "email_opt_in", label: "Agreed to receive emails", hint: "They said yes to emails from us." },
  {
    value: "sms_opt_in",
    label: "Agreed to receive text messages",
    hint: "Needs written consent (signed form or written reply), the cell number, and a note saying where the proof is.",
  },
  { value: "email_opt_out", label: "Opted out of emails", hint: "They asked us to stop emailing them." },
  { value: "sms_opt_out", label: "Opted out of text messages", hint: "They replied STOP or asked us not to text." },
  { value: "do_not_contact", label: "Do not contact at all", hint: "Stops all email and text outreach." },
  { value: "do_not_contact_cleared", label: "Lift do-not-contact", hint: "They asked to hear from us again. Needs a note." },
];

const METHODS: Array<{ value: ConsentMethod; label: string }> = [
  { value: "paper_form", label: "Signed form / sign-in sheet" },
  { value: "written_reply", label: "Written reply (email or text)" },
  { value: "verbal", label: "Verbal (in person or by phone)" },
];

export function ConsentForm({ contactId, cellPhone }: { contactId: string; cellPhone: string | null }) {
  const [kind, setKind] = useState<ConsentEventType>("email_opt_in");
  const [method, setMethod] = useState<ConsentMethod>("paper_form");
  const [occurredOn, setOccurredOn] = useState("");
  const [note, setNote] = useState("");
  const [cell, setCell] = useState(cellPhone ?? "");
  const [result, setResult] = useState<{ ok: true; message: string } | { ok: false; error: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  const active = KINDS.find((k) => k.value === kind)!;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await recordConsentAction(contactId, { type: kind, method, note, occurredOn, cellPhone: cell });
      setResult(res);
      // Keep everything on failure so the person can fix it; clear the evidence fields on success.
      if (res.ok) {
        setNote("");
        setOccurredOn("");
      }
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4 text-sm">
      <div className="space-y-2">
        {KINDS.map((k) => (
          <label key={k.value} className="flex items-start gap-3">
            <input
              type="radio"
              name="kind"
              checked={kind === k.value}
              onChange={() => {
                setKind(k.value);
                setResult(null);
              }}
              className="mt-1"
            />
            <span>
              <span className="font-medium text-slate-800">{k.label}</span>
              {kind === k.value && <span className="block text-xs text-slate-500">{k.hint}</span>}
            </span>
          </label>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="space-y-1">
          <label htmlFor="method" className="text-xs text-slate-500">
            How did you get it?
          </label>
          <select id="method" value={method} onChange={(e) => setMethod(e.target.value as ConsentMethod)} className={inputClass}>
            {METHODS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor="occurredOn" className="text-xs text-slate-500">
            Date they agreed (blank = today)
          </label>
          <input id="occurredOn" type="date" value={occurredOn} onChange={(e) => setOccurredOn(e.target.value)} className={inputClass} />
        </div>
        {kind === "sms_opt_in" && (
          <div className="space-y-1">
            <label htmlFor="cell" className="text-xs text-slate-500">
              Cell number they agreed to be texted on
            </label>
            <input id="cell" type="tel" value={cell} onChange={(e) => setCell(e.target.value)} className={inputClass} />
          </div>
        )}
      </div>

      {kind === "sms_opt_in" && method === "verbal" && (
        <p className="rounded bg-amber-50 px-3 py-2 text-xs text-amber-800">
          A verbal yes isn&apos;t enough for marketing texts. Choose a signed form or a written reply, or record email
          consent only.
        </p>
      )}

      <div className="space-y-1">
        <label htmlFor="note" className="text-xs text-slate-500">
          Note / where the proof is {["sms_opt_in", "do_not_contact_cleared"].includes(kind) ? "(required)" : "(optional)"}
        </label>
        <textarea
          id="note"
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. Sign-in sheet from the Sept 20 Realtor Expo, in the events binder"
          className={inputClass}
        />
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="rounded border border-[#003049] px-3 py-1.5 font-medium text-[#003049] disabled:opacity-50"
        >
          {isPending ? "Recording..." : "Record"}
        </button>
        {result?.ok && <span className="text-slate-600">{result.message}</span>}
        {result && !result.ok && <span className="text-red-600">{result.error}</span>}
      </div>
    </form>
  );
}
