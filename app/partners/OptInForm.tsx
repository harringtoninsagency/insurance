"use client";

import { useActionState } from "react";
import { submitOptInAction, type OptInState } from "./actions";
import { CONTACT_EMAIL, CONTACT_PHONE, EMAIL_CONSENT_TEXT, SMS_CONSENT_TEXT } from "@/lib/contacts/consent-text";

const inputClass =
  "w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-[#003049] focus:outline-none";

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

export function OptInForm() {
  const [state, formAction, isPending] = useActionState<OptInState, FormData>(submitOptInAction, null);
  const v = state && "error" in state ? state.values : {};

  if (state && "done" in state) {
    return (
      <div className="rounded-lg border border-[#F0FF00] bg-[#FFFFE6] px-5 py-6 text-[#003049]">
        <h2 className="text-lg font-semibold">You&apos;re on the list.</h2>
        <p className="mt-2 text-sm">
          Thanks — we&apos;ll send new-listing insurance snapshots to the email you gave us. Questions, or want a
          snapshot for a specific listing? Email {CONTACT_EMAIL} or call {CONTACT_PHONE}.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor="contact_type" className="text-xs font-medium text-slate-600">
            I am a
          </label>
          <select id="contact_type" name="contact_type" className={inputClass} defaultValue={v.contact_type || "realtor"}>
            <option value="realtor">Real estate agent / broker</option>
            <option value="mortgage_broker">Mortgage broker / loan officer</option>
          </select>
        </div>
        <Field id="full_name" defaultValue={v.full_name} label="Full name *" type="text" required autoComplete="name" />
        <Field id="company_name" defaultValue={v.company_name} label="Brokerage / company" type="text" autoComplete="organization" />
        <Field id="email" defaultValue={v.email} label="Email *" type="email" required autoComplete="email" />
        <Field id="cell_phone" defaultValue={v.cell_phone} label="Cell phone" type="tel" autoComplete="tel" />
        <Field id="office_phone" defaultValue={v.office_phone} label="Office phone" type="tel" />
        <Field id="license_number" defaultValue={v.license_number} label="License # (optional)" type="text" />
      </div>

      {/* Honeypot: hidden from people, tempting to bots. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="website">Website</label>
        <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <div className="space-y-3 rounded-lg bg-slate-100 p-4 text-xs text-slate-700">
        <label className="flex items-start gap-3">
          <input type="checkbox" name="email_consent" defaultChecked={v.email_consent === "on"} className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{EMAIL_CONSENT_TEXT} *</span>
        </label>
        <label className="flex items-start gap-3">
          <input type="checkbox" name="sms_consent" defaultChecked={v.sms_consent === "on"} className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{SMS_CONSENT_TEXT} (optional)</span>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <button
          type="submit"
          disabled={isPending}
          className="rounded bg-[#003049] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {isPending ? "Sending..." : "Send me snapshots"}
        </button>
        {state && "error" in state && <span className="text-sm text-red-600">{state.error}</span>}
      </div>

      <p className="text-xs text-slate-500">
        We use this information to send what you&apos;ve asked for and to follow up about insurance for your clients&apos;
        purchases. To update or remove your information, email {CONTACT_EMAIL} or call {CONTACT_PHONE}.
      </p>
    </form>
  );
}
