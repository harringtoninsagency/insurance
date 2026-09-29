"use client";

import { useActionState } from "react";
import { submitPublicQuoteRequestAction, type RequestQuoteState } from "./actions";
import { CONTACT_EMAIL, CONTACT_PHONE } from "@/lib/contacts/consent-text";

const inputClass = "w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-[#003049] focus:outline-none";

function Field({ id, label, ...props }: { id: string; label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-xs font-medium text-slate-600">
        {label}
      </label>
      <input id={id} name={id} className={inputClass} {...props} />
    </div>
  );
}

const STATUS_COPY: Record<string, string> = {
  processing: "We've matched it to county property records and we're getting carrier pricing now.",
  needs_review: "We couldn't fully match this address automatically — a producer will finish it up by hand.",
};

export function RequestQuoteForm() {
  const [state, formAction, isPending] = useActionState<RequestQuoteState, FormData>(submitPublicQuoteRequestAction, null);
  const v = state && "error" in state ? state.values : {};

  if (state && "done" in state) {
    return (
      <div className="rounded-lg border border-[#F0FF00] bg-[#FFFFE6] px-5 py-6 text-[#003049]">
        <h2 className="text-lg font-semibold">Request received.</h2>
        <p className="mt-2 text-sm">
          {STATUS_COPY[state.done.status] ?? "We've got your request."} We&apos;ll email your results to the address you gave us.
        </p>
        <p className="mt-3 text-sm">
          Questions in the meantime? Email {CONTACT_EMAIL} or call {CONTACT_PHONE}.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="requesterName" defaultValue={v.requesterName} label="Your name *" type="text" required autoComplete="name" />
        <Field id="requesterEmail" defaultValue={v.requesterEmail} label="Your email *" type="email" required autoComplete="email" />
        <Field id="requesterPhone" defaultValue={v.requesterPhone} label="Your phone (optional)" type="tel" autoComplete="tel" />
        <div className="space-y-1">
          <label htmlFor="requestKind" className="text-xs font-medium text-slate-600">
            What would you like? *
          </label>
          <select id="requestKind" name="requestKind" className={inputClass} defaultValue={v.requestKind || "quote_summary"}>
            <option value="quote_summary">A multi-carrier quote summary</option>
            <option value="listing_snapshot">A buyer-facing listing snapshot</option>
            <option value="both">Both</option>
          </select>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="addressLine" defaultValue={v.addressLine} label="Property street address *" type="text" required className={`${inputClass} sm:col-span-2`} />
        <Field id="city" defaultValue={v.city} label="City *" type="text" required />
        <div className="grid grid-cols-2 gap-4">
          <Field id="state" defaultValue={v.state || "FL"} label="State" type="text" />
          <Field id="zipcode" defaultValue={v.zipcode} label="Zip" type="text" />
        </div>
      </div>

      <details className="rounded border border-slate-200 p-3 text-sm">
        <summary className="cursor-pointer font-medium text-slate-700">Know more about the property? (optional, speeds things up)</summary>
        <div className="mt-3 grid gap-4 sm:grid-cols-3">
          <Field id="yearBuilt" defaultValue={v.yearBuilt} label="Year built" type="number" />
          <Field id="sqft" defaultValue={v.sqft} label="Square footage" type="number" />
          <Field id="construction" defaultValue={v.construction} label="Construction (frame/masonry)" type="text" />
          <Field id="beds" defaultValue={v.beds} label="Bedrooms" type="number" />
          <Field id="baths" defaultValue={v.baths} label="Bathrooms" type="number" step="0.5" />
          <Field id="listPrice" defaultValue={v.listPrice} label="List price" type="number" />
        </div>
      </details>

      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="website">Website</label>
        <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <button type="submit" disabled={isPending} className="rounded bg-[#003049] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
          {isPending ? "Sending..." : "Request my quote"}
        </button>
        {state && "error" in state && <span className="text-sm text-red-600">{state.error}</span>}
      </div>
    </form>
  );
}
