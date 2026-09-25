"use client";

import { useActionState } from "react";
import { addContactAction, type AddContactState } from "./actions";

const inputClass = "w-full rounded border border-slate-300 px-2 py-1.5 text-sm";

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

export function AddContactForm() {
  const [state, formAction, isPending] = useActionState<AddContactState, FormData>(addContactAction, null);

  return (
    <form action={formAction} className="grid grid-cols-3 gap-4 text-sm">
      <div className="space-y-1">
        <label htmlFor="contact_type" className="text-xs text-slate-500">
          Type
        </label>
        <select id="contact_type" name="contact_type" className={inputClass}>
          <option value="realtor">Realtor</option>
          <option value="mortgage_broker">Mortgage broker</option>
        </select>
      </div>
      <Field id="full_name" label="Full name" type="text" required />
      <Field id="company_name" label="Company / brokerage" type="text" />
      <Field id="cell_phone" label="Cell phone" type="tel" />
      <Field id="office_phone" label="Office phone" type="tel" />
      <Field id="email" label="Email" type="email" />
      <Field id="license_number" label="License # (optional)" type="text" />
      <Field id="city" label="City (optional)" type="text" />
      <div className="space-y-1">
        <label htmlFor="source" className="text-xs text-slate-500">
          Where did you get this?
        </label>
        <select id="source" name="source" className={inputClass} defaultValue="manual">
          <option value="manual">Entered by hand</option>
          <option value="referral">Referral</option>
          <option value="event">Event / business card</option>
          <option value="web_form">Signed up on our site</option>
          <option value="public_license">Public license record</option>
          <option value="other">Other</option>
        </select>
      </div>
      <div className="col-span-3 flex items-center gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="rounded border border-[#003049] px-3 py-1.5 text-sm font-medium text-[#003049] disabled:opacity-50"
        >
          {isPending ? "Saving..." : "Add contact"}
        </button>
        {state && "added" in state && <span className="text-sm text-slate-500">Added {state.added}.</span>}
        {state && "updated" in state && (
          <span className="text-sm text-slate-500">{state.updated} already existed — filled in any missing details.</span>
        )}
        {state && "error" in state && <span className="text-sm text-red-600">{state.error}</span>}
      </div>
    </form>
  );
}
