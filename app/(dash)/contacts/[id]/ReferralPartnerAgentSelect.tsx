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
  referralPartnerAgent: string | null;
  teamMembers: TeamMember[];
}

export function ReferralPartnerAgentSelect({ contactId, referralPartnerAgent, teamMembers }: Props) {
  async function runAction(_prev: State, formData: FormData): Promise<State> {
    return updateReferralPartnerAgentAction(contactId, formData);
  }

  const [state, formAction, isPending] = useActionState<State, FormData>(runAction, null);

  // The stored value is a name snapshot, not a profile id — if it doesn't
  // match any current team member's name (e.g. someone no longer active),
  // keep it selectable as its own option so the field isn't silently blanked.
  const names = teamMembers.map((m) => m.full_name ?? m.email);
  const options = referralPartnerAgent && !names.includes(referralPartnerAgent) ? [referralPartnerAgent, ...names] : names;

  return (
    <form action={formAction}>
      <select
        name="referral_partner_agent"
        defaultValue={referralPartnerAgent ?? ""}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        disabled={isPending}
        aria-label="Referral partner agent"
        className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm disabled:opacity-50"
      >
        <option value="">— None selected —</option>
        {options.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
      {state && !state.ok && <p className="mt-1 text-xs text-red-600">{state.error}</p>}
    </form>
  );
}
