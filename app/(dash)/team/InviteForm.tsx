"use client";

import { useActionState } from "react";
import { inviteTeamMemberAction, type InviteState } from "./actions";

const inputClass = "w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-[#003049] focus:outline-none";

export function InviteForm() {
  const [state, formAction, isPending] = useActionState<InviteState, FormData>(inviteTeamMemberAction, null);

  return (
    <form action={formAction} className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
      <h2 className="text-sm font-semibold text-[#003049]">Invite a team member</h2>
      <div className="grid gap-4 sm:grid-cols-[1fr_1fr_auto]">
        <div className="space-y-1">
          <label htmlFor="full_name" className="text-xs font-medium text-slate-600">Full name</label>
          <input id="full_name" name="full_name" type="text" required className={inputClass} />
        </div>
        <div className="space-y-1">
          <label htmlFor="email" className="text-xs font-medium text-slate-600">Work email</label>
          <input id="email" name="email" type="email" required className={inputClass} />
        </div>
        <div className="space-y-1">
          <label htmlFor="role" className="text-xs font-medium text-slate-600">Role</label>
          <select id="role" name="role" defaultValue="producer" className={inputClass}>
            <option value="producer">Agent</option>
            <option value="admin">Admin</option>
          </select>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={isPending} className="rounded bg-[#003049] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {isPending ? "Sending..." : "Send invite"}
        </button>
        {state && "invited" in state && <span className="text-sm text-green-700">Invite emailed to {state.invited}.</span>}
        {state && "error" in state && <span className="text-sm text-red-600">{state.error}</span>}
      </div>
      <p className="text-xs text-slate-500">
        They get an email with a link to choose their own password. Agents can use quotes, properties, and contacts;
        admins can also manage this team.
      </p>
    </form>
  );
}
