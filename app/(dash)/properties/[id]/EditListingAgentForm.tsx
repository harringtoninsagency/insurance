"use client";

import { useActionState } from "react";
import Link from "next/link";
import { updateListingAgentAction } from "./actions";
import type { ListingAgentResult } from "@/lib/properties/listing-agent";

type State = ListingAgentResult | null;

interface Props {
  propertyId: string;
  name: string | null;
  email: string | null;
  phone: string | null;
}

export function EditListingAgentForm({ propertyId, name, email, phone }: Props) {
  async function runAction(_prev: State, formData: FormData): Promise<State> {
    return updateListingAgentAction(propertyId, formData);
  }

  const [state, formAction, isPending] = useActionState<State, FormData>(runAction, null);

  return (
    <form action={formAction} className="grid grid-cols-3 gap-4 text-sm">
      <div className="space-y-1">
        <label htmlFor="listing_agent_name" className="text-xs text-slate-500">
          Name
        </label>
        <input
          id="listing_agent_name"
          name="listing_agent_name"
          type="text"
          defaultValue={name ?? ""}
          className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
        />
      </div>
      <div className="space-y-1">
        <label htmlFor="listing_agent_email" className="text-xs text-slate-500">
          Email
        </label>
        <input
          id="listing_agent_email"
          name="listing_agent_email"
          type="email"
          defaultValue={email ?? ""}
          className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
        />
      </div>
      <div className="space-y-1">
        <label htmlFor="listing_agent_phone" className="text-xs text-slate-500">
          Phone
        </label>
        <input
          id="listing_agent_phone"
          name="listing_agent_phone"
          type="tel"
          defaultValue={phone ?? ""}
          className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
        />
      </div>
      <div className="col-span-3 flex items-center gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="rounded border border-[#003049] px-3 py-1.5 text-sm font-medium text-[#003049] disabled:opacity-50"
        >
          {isPending ? "Saving..." : "Save"}
        </button>
        {state?.ok && (
          <span className="text-sm text-slate-600">
            Saved.{" "}
            {state.directory === "added" && "Added to the Realtors & Brokers directory. "}
            {state.directory === "updated" && "Directory entry updated. "}
            {state.directory === "unchanged" && "Already in the directory. "}
            {state.contactId && (
              <Link href={`/contacts/${state.contactId}`} className="font-medium text-[#003049] underline">
                View in directory
              </Link>
            )}
            {state.note && <span className="text-amber-700">{state.note}</span>}
          </span>
        )}
        {state && !state.ok && <span className="text-sm text-red-600">{state.error}</span>}
      </div>
    </form>
  );
}
