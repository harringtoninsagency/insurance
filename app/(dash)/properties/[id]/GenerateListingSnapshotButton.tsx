"use client";

import { useActionState } from "react";
import { generateListingSnapshotAction } from "./actions";

type State = { version: number } | { error: string } | null;

async function runAction(_prev: State, propertyId: string): Promise<State> {
  try {
    const result = await generateListingSnapshotAction(propertyId);
    return { version: result.version };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to generate listing snapshot" };
  }
}

export function GenerateListingSnapshotButton({ propertyId }: { propertyId: string }) {
  const [state, formAction, isPending] = useActionState<State, string>(runAction, null);

  return (
    <div className="flex items-center gap-3">
      <form action={() => formAction(propertyId)}>
        <button
          type="submit"
          disabled={isPending}
          className="rounded border border-[#003049] px-3 py-1.5 text-sm font-medium text-[#003049] transition-colors hover:bg-[#003049]/5 disabled:opacity-50"
        >
          {isPending ? "Generating..." : "Generate listing snapshot"}
        </button>
      </form>
      {state && "version" in state && (
        <span className="text-sm text-slate-500">Generated v{state.version}.</span>
      )}
      {state && "error" in state && <span className="text-sm text-red-600">{state.error}</span>}
    </div>
  );
}
