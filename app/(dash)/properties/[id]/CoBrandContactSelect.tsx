"use client";

import { useActionState, useState } from "react";
import { updateCoBrandContactAction } from "./actions";

type State = { ok: true } | { ok: false; error: string } | null;

interface ReferralPartnerOption {
  id: string;
  fullName: string;
  companyName: string | null;
}

interface Props {
  propertyId: string;
  contactId: string | null;
  referralPartners: ReferralPartnerOption[];
}

export function CoBrandContactSelect({ propertyId, contactId, referralPartners }: Props) {
  async function runAction(_prev: State, formData: FormData): Promise<State> {
    return updateCoBrandContactAction(propertyId, formData);
  }

  const [state, formAction, isPending] = useActionState<State, FormData>(runAction, null);
  const savedValue = contactId ?? "";
  const [selected, setSelected] = useState(savedValue);
  const dirty = selected !== savedValue;

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-1.5">
      <select
        name="contact_id"
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
        disabled={isPending}
        aria-label="Co-branded referral partner"
        className="rounded border border-slate-300 bg-white px-2 py-1 text-sm disabled:opacity-50"
      >
        <option value="">— None —</option>
        {referralPartners.map((p) => (
          <option key={p.id} value={p.id}>
            {p.fullName}
            {p.companyName ? ` (${p.companyName})` : ""}
          </option>
        ))}
      </select>
      <button
        type="submit"
        disabled={!dirty || isPending}
        className="shrink-0 rounded border border-[#003049] px-2 py-1 text-xs font-medium text-[#003049] transition-colors hover:bg-[#003049]/5 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
      >
        {isPending ? "Saving..." : "Save"}
      </button>
      {state && state.ok && !dirty && <span className="text-xs text-green-700">Saved — regenerating proposals.</span>}
      {state && !state.ok && <p className="w-full text-xs text-red-600">{state.error}</p>}
    </form>
  );
}
