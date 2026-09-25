"use client";

import Link from "next/link";
import { useTransition } from "react";
import { markDoNotContactAction } from "./actions";

export function DoNotContactButton({ contactId, doNotContact }: { contactId: string; doNotContact: boolean }) {
  const [isPending, startTransition] = useTransition();

  if (doNotContact) {
    // Lifting it needs a recorded reason, so it's handled on the contact's page.
    return (
      <Link href={`/contacts/${contactId}`} className="rounded bg-red-100 px-2 py-1 text-xs font-medium text-red-700">
        Do not contact
      </Link>
    );
  }
  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() => startTransition(() => markDoNotContactAction(contactId))}
      className="rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-600 disabled:opacity-50"
    >
      Mark DNC
    </button>
  );
}
