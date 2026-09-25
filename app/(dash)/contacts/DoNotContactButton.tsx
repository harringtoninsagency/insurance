"use client";

import { useTransition } from "react";
import { setDoNotContactAction } from "./actions";

export function DoNotContactButton({ contactId, doNotContact }: { contactId: string; doNotContact: boolean }) {
  const [isPending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() => startTransition(() => setDoNotContactAction(contactId, !doNotContact))}
      className={`rounded px-2 py-1 text-xs font-medium disabled:opacity-50 ${
        doNotContact ? "bg-red-100 text-red-700" : "border border-slate-300 text-slate-600"
      }`}
    >
      {doNotContact ? "Do not contact" : "Mark DNC"}
    </button>
  );
}
