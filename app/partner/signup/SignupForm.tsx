"use client";

import { useActionState } from "react";
import { requestAccessAction } from "./actions";
import type { AccessRequestResult } from "@/lib/partners/request-access";

const inputClass = "w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-[#003049] focus:outline-none";

export function SignupForm({ agentId, agentName }: { agentId: string | null; agentName: string | null }) {
  const [state, formAction, isPending] = useActionState<AccessRequestResult | null, FormData>(requestAccessAction, null);

  if (state?.ok) {
    return (
      <div className="space-y-2 rounded bg-green-50 px-4 py-3 text-sm text-green-800">
        <p className="font-medium">Request submitted.</p>
        <p>We verify your license and follow up within one business day with your login.</p>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-5">
      {agentId && <input type="hidden" name="agent_id" value={agentId} />}
      {agentName && (
        <p className="rounded bg-[#F0FF00]/20 px-3 py-2 text-xs text-[#003049]">
          You&apos;ll be connected with <span className="font-semibold">{agentName}</span>.
        </p>
      )}

      <div className="space-y-1">
        <label htmlFor="full_name" className="text-sm font-medium text-[#003049]">
          Full name
        </label>
        <input id="full_name" name="full_name" type="text" required className={inputClass} />
      </div>

      <div className="space-y-1">
        <label htmlFor="contact_type" className="text-sm font-medium text-[#003049]">
          I am a
        </label>
        <select id="contact_type" name="contact_type" required defaultValue="" className={inputClass}>
          <option value="" disabled>
            Choose one
          </option>
          <option value="realtor">Realtor</option>
          <option value="mortgage_broker">Mortgage broker</option>
          <option value="roofing_company">Roofing company</option>
        </select>
      </div>

      <div className="space-y-1">
        <label htmlFor="company_name" className="text-sm font-medium text-[#003049]">
          Brokerage / company
        </label>
        <input id="company_name" name="company_name" type="text" required className={inputClass} />
      </div>

      <div className="space-y-1">
        <label htmlFor="license_number" className="text-sm font-medium text-[#003049]">
          License number
        </label>
        <input id="license_number" name="license_number" type="text" required className={inputClass} />
        <p className="text-xs text-slate-500">
          Your active Florida real estate, mortgage originator (NMLS), or contractor license — we verify this before approving access.
        </p>
      </div>

      <div className="space-y-1">
        <label htmlFor="email" className="text-sm font-medium text-[#003049]">
          Email
        </label>
        <input id="email" name="email" type="email" required className={inputClass} />
        <p className="text-xs text-slate-500">This becomes your login once approved.</p>
      </div>

      <div className="space-y-1">
        <label htmlFor="phone" className="text-sm font-medium text-[#003049]">
          Phone number
        </label>
        <input
          id="phone"
          name="phone"
          type="tel"
          inputMode="numeric"
          required
          placeholder="10 digits, e.g. 7275551234"
          pattern="^\D*\d(?:\D*\d){9}\D*$"
          title="Enter a 10-digit phone number"
          className={inputClass}
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="buyers_per_month" className="text-sm font-medium text-[#003049]">
          Buyers per month <span className="font-normal text-slate-400">(optional)</span>
        </label>
        <input id="buyers_per_month" name="buyers_per_month" type="text" placeholder="e.g. 3-5" className={inputClass} />
        <p className="text-xs text-slate-500">Helps us size your access — not a requirement for approval.</p>
      </div>

      {state && !state.ok && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}

      <button
        type="submit"
        disabled={isPending}
        className="w-full rounded-full bg-[#F0FF00] px-4 py-2.5 text-sm font-bold text-[#003049] transition-colors hover:brightness-95 disabled:opacity-50"
      >
        {isPending ? "Submitting..." : "Request access"}
      </button>
    </form>
  );
}
