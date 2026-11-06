"use client";

import { useState, useTransition } from "react";
import { updateReferralPartnerAgentAction } from "../actions";

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
  const [selected, setSelected] = useState(referralPartnerAgentId ?? "");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const dirty = selected !== (referralPartnerAgentId ?? "");

  function save() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("referral_partner_agent_id", selected);
      const result = await updateReferralPartnerAgentAction(contactId, formData);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSaved(true);
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={selected}
        onChange={(e) => {
          setSelected(e.target.value);
          setSaved(false);
        }}
        disabled={isPending}
        aria-label="Referral partner agent"
        className="rounded border border-slate-300 bg-white px-2 py-1 text-sm disabled:opacity-50"
      >
        <option value="">— None selected —</option>
        {teamMembers.map((m) => (
          <option key={m.id} value={m.id}>
            {m.full_name ?? m.email}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={save}
        disabled={isPending || !dirty}
        className="rounded border border-[#003049] px-2.5 py-1 text-xs font-medium text-[#003049] hover:bg-[#003049]/5 disabled:opacity-50"
      >
        {isPending ? "Saving..." : "Save"}
      </button>
      {saved && !dirty && <span className="text-xs text-green-700">Saved — locked in for cobranding.</span>}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
