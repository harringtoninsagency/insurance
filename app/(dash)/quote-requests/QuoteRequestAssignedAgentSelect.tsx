"use client";

import { useActionState, useState } from "react";
import { updateQuoteRequestAssignedAgentAction } from "./actions";

type State = { ok: true } | { ok: false; error: string } | null;

interface TeamMember {
  id: string;
  full_name: string | null;
  email: string;
}

interface Props {
  requestId: string;
  assignedAgentId: string | null;
  teamMembers: TeamMember[];
}

export function QuoteRequestAssignedAgentSelect({ requestId, assignedAgentId, teamMembers }: Props) {
  async function runAction(_prev: State, formData: FormData): Promise<State> {
    return updateQuoteRequestAssignedAgentAction(requestId, formData);
  }

  const [state, formAction, isPending] = useActionState<State, FormData>(runAction, null);
  const savedValue = assignedAgentId ?? "";
  const [selected, setSelected] = useState(savedValue);
  const dirty = selected !== savedValue;

  return (
    <form action={formAction} className="flex items-center gap-1.5">
      <select
        name="assigned_agent_id"
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
        disabled={isPending}
        aria-label="Assigned agent"
        className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs disabled:opacity-50"
      >
        <option value="">— Unassigned —</option>
        {teamMembers.map((m) => (
          <option key={m.id} value={m.id}>
            {m.full_name ?? m.email}
          </option>
        ))}
      </select>
      {dirty && (
        <button
          type="submit"
          disabled={isPending}
          className="shrink-0 rounded border border-[#003049] px-2 py-1 text-xs font-medium text-[#003049] transition-colors hover:bg-[#003049]/5 disabled:cursor-default disabled:opacity-40"
        >
          {isPending ? "Saving..." : "Save"}
        </button>
      )}
      {state && !state.ok && <p className="mt-1 text-xs text-red-600">{state.error}</p>}
    </form>
  );
}
