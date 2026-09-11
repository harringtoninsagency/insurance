"use client";

import { useActionState } from "react";
import { approveOutreachAction, rejectOutreachAction } from "./actions";

type State = { done: "approved" | "rejected" } | { error: string } | null;

export function ReviewActions({ outreachId }: { outreachId: string }) {
  async function runApprove(_prev: State, id: string): Promise<State> {
    try {
      await approveOutreachAction(id);
      return { done: "approved" };
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Failed to approve" };
    }
  }

  async function runReject(_prev: State, id: string): Promise<State> {
    try {
      await rejectOutreachAction(id);
      return { done: "rejected" };
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Failed to reject" };
    }
  }

  const [approveState, approveAction, approvePending] = useActionState<State, string>(runApprove, null);
  const [rejectState, rejectAction, rejectPending] = useActionState<State, string>(runReject, null);
  const state = approveState ?? rejectState;
  const isPending = approvePending || rejectPending;

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        <form action={() => approveAction(outreachId)}>
          <button
            type="submit"
            disabled={isPending}
            className="rounded bg-[#003049] px-3 py-1.5 text-white transition-colors hover:bg-[#012333] disabled:opacity-40"
          >
            Approve
          </button>
        </form>
        <form action={() => rejectAction(outreachId)}>
          <button
            type="submit"
            disabled={isPending}
            className="rounded border border-[#003049] px-3 py-1.5 text-[#003049] disabled:opacity-40"
          >
            Reject
          </button>
        </form>
      </div>
      {state && "error" in state && <span className="text-xs text-red-600">{state.error}</span>}
    </div>
  );
}
