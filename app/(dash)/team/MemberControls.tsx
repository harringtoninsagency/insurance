"use client";

import { useState, useTransition } from "react";
import { sendPasswordLinkAction, setActiveAction, setRoleAction } from "./actions";
import type { TeamResult } from "@/lib/team/team";

export function MemberControls({
  memberId,
  role,
  active,
  invitePending,
  isSelf,
}: {
  memberId: string;
  role: "producer" | "admin";
  active: boolean;
  invitePending: boolean;
  isSelf: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  function run(action: () => Promise<TeamResult>, okText: string) {
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      setMessage(result.ok ? { tone: "ok", text: okText } : { tone: "error", text: result.error });
    });
  }

  const buttonClass = "rounded border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50";

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Role"
          value={role}
          disabled={isPending || !active}
          onChange={(e) => run(() => setRoleAction(memberId, e.target.value === "admin" ? "admin" : "producer"), "Role updated.")}
          className="rounded border border-slate-300 bg-white px-2 py-1 text-xs"
        >
          <option value="producer">Agent</option>
          <option value="admin">Admin</option>
        </select>
        {active && (
          <button type="button" disabled={isPending} onClick={() => run(() => sendPasswordLinkAction(memberId), "Email sent.")} className={buttonClass}>
            {invitePending ? "Resend invite" : "Send password reset"}
          </button>
        )}
        {!isSelf && (
          <button
            type="button"
            disabled={isPending}
            onClick={() => run(() => setActiveAction(memberId, !active), active ? "Deactivated." : "Reactivated.")}
            className={buttonClass}
          >
            {active ? "Deactivate" : "Reactivate"}
          </button>
        )}
      </div>
      {message && <p className={`text-xs ${message.tone === "ok" ? "text-green-700" : "text-red-600"}`}>{message.text}</p>}
    </div>
  );
}
