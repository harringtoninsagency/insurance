"use client";

import { useActionState } from "react";
import { updateReferralPartnerAgentAction } from "../actions";

type State = { ok: true } | { ok: false; error: string } | null;

interface TeamMember {
  id: string;
  full_name: string | null;
  email: string;
}

interface Props {
  contactId: string;
  referralPartnerAgentId: string | null;
  teamMembers: TeamMember[];
}

export function ReferralPartnerAgentSelect({ contactId, referralPartnerAgentId, teamMembers }: Props) {
  async function runAction(_prev: State, formData: FormData): Promise<State> {
    return updateReferralPartnerAgentAction(contactId, formData);
  }

  const [state, formAction, isPending] = useActionState<State, FormData>(runAction, null);

  return (
    <form action={formAction}>
      <select
        name="referral_partner_agent_id"
        defaultValue={referralPartnerAgentId ?? ""}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        disabled={isPending}
        aria-label="Referral partner agent"
        className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm disabled:opacity-50"
      >
        <option value="">— None selected —</option>
        {teamMembers.map((m) => (
          <option key={m.id} value={m.id}>
            {m.full_name ?? m.email}
          </option>
        ))}
      </select>
      {state && !state.ok && <p className="mt-1 text-xs text-red-600">{state.error}</p>}
    </form>
  );
}
