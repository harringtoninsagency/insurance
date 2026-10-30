"use client";

import { useActionState, useState } from "react";
import { submitConsumerQuoteAction, type ConsumerQuoteState } from "./actions";
import { AddressAutocompleteInput, type ParsedAddress } from "./AddressAutocompleteInput";
import { CONTACT_EMAIL, CONTACT_PHONE } from "@/lib/contacts/consent-text";

const inputClass =
  "w-full rounded border border-slate-300 bg-white px-4 py-3 text-base text-slate-900 focus:border-[#003049] focus:outline-none";

function Field({ id, label, ...props }: { id: string; label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-sm font-medium text-slate-700">
        {label}
      </label>
      <input id={id} name={id} className={inputClass} {...props} />
    </div>
  );
}

export function QuoteForm() {
  const [state, formAction, isPending] = useActionState<ConsumerQuoteState, FormData>(submitConsumerQuoteAction, null);
  const v = state && "error" in state ? state.values : {};
  const [address, setAddress] = useState<ParsedAddress | null>(null);

  if (state && "done" in state) {
    return (
      <div className="rounded-xl border border-[#F0FF00] bg-[#FFFFE6] px-6 py-8 text-center text-[#003049]">
        <h2 className="text-xl font-semibold">You&apos;re all set!</h2>
        <p className="mt-2 text-sm">
          We&apos;re pulling pricing from multiple Florida carriers now. Your estimate will land in your inbox shortly, and a
          licensed agent will follow up to answer any questions.
        </p>
        <p className="mt-4 text-xs text-[#003049]/70">
          Questions in the meantime? Email {CONTACT_EMAIL} or call {CONTACT_PHONE}.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="firstName" name="firstName" label="First name" type="text" required autoComplete="given-name" defaultValue={v.firstName} />
        <Field id="lastName" name="lastName" label="Last name" type="text" required autoComplete="family-name" defaultValue={v.lastName} />
      </div>

      <div className="space-y-1">
        <label htmlFor="formattedAddress" className="text-sm font-medium text-slate-700">
          Property address
        </label>
        <AddressAutocompleteInput onSelect={setAddress} />
        <input type="hidden" name="addressLine" value={address?.addressLine ?? ""} />
        <input type="hidden" name="city" value={address?.city ?? ""} />
        <input type="hidden" name="state" value={address?.state ?? "FL"} />
        <input type="hidden" name="zipcode" value={address?.zipcode ?? ""} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="phone" name="phone" label="Phone number" type="tel" required autoComplete="tel" placeholder="727-555-0123" defaultValue={v.phone} />
        <Field id="email" name="email" label="Email" type="email" required autoComplete="email" defaultValue={v.email} />
      </div>

      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="website">Website</label>
        <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <button
        type="submit"
        disabled={isPending || !address}
        className="w-full rounded-full bg-[#F0FF00] px-6 py-3.5 text-base font-bold text-[#003049] transition-colors hover:brightness-95 disabled:opacity-50"
      >
        {isPending ? "Getting your quote..." : "Get My Free Quote"}
      </button>
      {!address && <p className="text-center text-xs text-slate-500">Choose your address from the suggestions above to continue.</p>}
      {state && "error" in state && <p className="text-center text-sm text-red-600">{state.error}</p>}

      <p className="text-center text-xs text-slate-400">No obligation. We never sell your information.</p>
    </form>
  );
}
