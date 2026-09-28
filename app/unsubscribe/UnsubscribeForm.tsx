"use client";

import { useActionState } from "react";
import { confirmUnsubscribeAction, type UnsubscribeState } from "./actions";

export function UnsubscribeForm({ token }: { token: string }) {
  const [state, formAction, isPending] = useActionState<UnsubscribeState, FormData>(
    () => confirmUnsubscribeAction(token),
    null
  );

  if (state && "done" in state) {
    return (
      <p className="rounded-lg border border-[#F0FF00] bg-[#FFFFE6] px-4 py-3 text-sm text-[#003049]">
        Done — {state.done} won&apos;t receive any more emails from us.
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-3">
      <button
        type="submit"
        disabled={isPending}
        className="rounded bg-[#003049] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
      >
        {isPending ? "Unsubscribing..." : "Yes, unsubscribe me"}
      </button>
      {state && "error" in state && <p className="text-sm text-red-600">{state.error}</p>}
    </form>
  );
}
