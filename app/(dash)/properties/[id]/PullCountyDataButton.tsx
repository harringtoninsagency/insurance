"use client";

import { useActionState } from "react";
import { pullCountyDataAction } from "./actions";

type State = { matched: boolean } | null;

async function runAction(_prev: State, propertyId: string): Promise<State> {
  return pullCountyDataAction(propertyId);
}

export function PullCountyDataButton({ propertyId }: { propertyId: string }) {
  const [state, formAction, isPending] = useActionState<State, string>(runAction, null);

  return (
    <div className="flex items-center gap-3">
      <form action={() => formAction(propertyId)}>
        <button
          type="submit"
          disabled={isPending}
          className="rounded border border-slate-300 px-3 py-1.5 text-sm font-medium disabled:opacity-50"
        >
          {isPending ? "Looking up..." : "Pull county data"}
        </button>
      </form>
      {state && (
        <span className="text-sm text-slate-500">
          {state.matched ? "Matched — property updated." : "No county parcel match found for this address."}
        </span>
      )}
    </div>
  );
}
