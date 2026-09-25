"use client";

import { useActionState } from "react";
import { queueOutreachAction } from "./actions";

type State = { queued: true } | { error: string } | null;

interface DirectoryOption {
  email: string;
  label: string;
}

export function QueueOutreachForm({
  propertyId,
  proposalId,
  contacts,
}: {
  propertyId: string;
  proposalId: string;
  contacts: DirectoryOption[];
}) {
  async function runAction(_prev: State, formData: FormData): Promise<State> {
    const recipient = String(formData.get("recipient") ?? "");
    try {
      await queueOutreachAction(propertyId, proposalId, recipient);
      return { queued: true };
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Failed to queue outreach" };
    }
  }

  const [state, formAction, isPending] = useActionState<State, FormData>(runAction, null);

  return (
    <form action={formAction} className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-3">
      <input
        type="email"
        name="recipient"
        required
        placeholder="Pick from directory or type an email"
        list="directory-contacts"
        className="w-80 rounded border border-slate-300 px-3 py-1.5 text-sm"
      />
      <datalist id="directory-contacts">
        {contacts.map((c) => (
          <option key={c.email} value={c.email}>
            {c.label}
          </option>
        ))}
      </datalist>
      <button
        type="submit"
        disabled={isPending}
        className="rounded border border-[#003049] px-3 py-1.5 text-sm font-medium text-[#003049] disabled:opacity-50"
      >
        {isPending ? "Queuing..." : "Queue for review"}
      </button>
      {state && "queued" in state && (
        <span className="text-sm text-slate-500">Queued — see Outreach review.</span>
      )}
      {state && "error" in state && <span className="text-sm text-red-600">{state.error}</span>}
    </form>
  );
}
