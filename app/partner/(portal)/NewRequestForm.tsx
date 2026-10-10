"use client";

import { useActionState } from "react";
import { submitPartnerQuoteRequestAction, type PartnerRequestState } from "./actions";

const inputClass = "w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm focus:border-[#003049] focus:outline-none";

function Field({ id, label, ...props }: { id: string; label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-xs text-slate-500">
        {label}
      </label>
      <input id={id} name={id} className={inputClass} {...props} />
    </div>
  );
}

const STATUS_COPY: Record<string, string> = {
  processing: "Matched to county property records — a carrier quote is next.",
  needs_review: "Couldn't fully match that address automatically — a producer will finish it by hand.",
};

export function NewRequestForm({ defaultEmail }: { defaultEmail: string }) {
  const [state, formAction, isPending] = useActionState<PartnerRequestState, FormData>(submitPartnerQuoteRequestAction, null);
  const v = state && "error" in state ? state.values : {};

  return (
    <details className="rounded-lg border border-slate-200 bg-white p-5" open={!state || "error" in state}>
      <summary className="cursor-pointer font-medium text-[#003049]">Request a new quote</summary>

      {state && "done" in state ? (
        <p className="mt-4 rounded bg-green-50 px-3 py-2 text-sm text-green-800">
          Request sent. {STATUS_COPY[state.done.status] ?? "We'll follow up shortly."}
        </p>
      ) : (
        <form action={formAction} className="mt-4 space-y-4 text-sm">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="requesterEmail" defaultValue={v.requesterEmail || defaultEmail} label="Send results to" type="email" required />
            <Field id="requesterPhone" defaultValue={v.requesterPhone} label="Phone (optional)" type="tel" />
            <div className="space-y-1">
              <label htmlFor="requestKind" className="text-xs text-slate-500">
                What would you like?
              </label>
              <select id="requestKind" name="requestKind" className={inputClass} defaultValue={v.requestKind || "quote_summary"}>
                <option value="quote_summary">Multi-carrier quote summary</option>
                <option value="listing_snapshot">Buyer-facing listing snapshot</option>
                <option value="both">Both</option>
              </select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="addressLine" defaultValue={v.addressLine} label="Property street address" type="text" required className={`${inputClass} sm:col-span-2`} />
            <Field id="city" defaultValue={v.city} label="City" type="text" required />
            <div className="grid grid-cols-2 gap-4">
              <Field id="state" defaultValue={v.state || "FL"} label="State" type="text" />
              <Field id="zipcode" defaultValue={v.zipcode} label="Zip" type="text" />
            </div>
          </div>

          <details className="rounded border border-slate-200 p-3">
            <summary className="cursor-pointer text-xs font-medium text-slate-600">Know more about the property? (optional)</summary>
            <div className="mt-3 grid gap-4 sm:grid-cols-3">
              <Field id="yearBuilt" defaultValue={v.yearBuilt} label="Year built" type="number" />
              <Field id="sqft" defaultValue={v.sqft} label="Square footage" type="number" />
              <Field id="construction" defaultValue={v.construction} label="Construction" type="text" />
              <Field id="beds" defaultValue={v.beds} label="Bedrooms" type="number" />
              <Field id="baths" defaultValue={v.baths} label="Bathrooms" type="number" step="0.5" />
              <Field id="listPrice" defaultValue={v.listPrice} label="List price" type="number" />
            </div>
          </details>

          <div className="space-y-2">
            <button
              type="submit"
              disabled={isPending}
              className="w-full rounded-lg bg-[#003049] px-6 py-4 text-xl font-bold text-white shadow-md transition hover:bg-[#012333] disabled:opacity-50 sm:text-2xl"
            >
              {isPending ? "Sending..." : "Request Property Insurance Quote Now"}
            </button>
            {state && "error" in state && <p className="text-sm text-red-600">{state.error}</p>}
          </div>
        </form>
      )}
    </details>
  );
}
