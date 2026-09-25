"use server";

import { headers } from "next/headers";
import { createServiceSupabase } from "@/lib/supabase/server";
import { recordOptIn } from "@/lib/contacts/record-opt-in";

// On error the submitted values come back so the form can re-fill itself —
// React clears uncontrolled fields after every action, which would otherwise
// wipe what the person typed.
export type OptInValues = Record<string, string>;
export type OptInState = { done: true } | { error: string; values: OptInValues } | null;

const FIELDS = ["contact_type", "full_name", "company_name", "email", "cell_phone", "office_phone", "license_number"];

const str = (formData: FormData, key: string) => String(formData.get(key) ?? "").trim();

// Public, unauthenticated endpoint: everything is validated in recordOptIn and
// the response never reveals whether the person was already on file.
export async function submitOptInAction(_prev: OptInState, formData: FormData): Promise<OptInState> {
  // Hidden honeypot field: real people never fill it, form-stuffing bots do.
  // Answer "success" so the bot gets no signal to adapt to.
  if (str(formData, "website")) return { done: true };

  const requestHeaders = await headers();
  const ip = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() || requestHeaders.get("x-real-ip") || null;

  const result = await recordOptIn(createServiceSupabase(), {
    contactType: str(formData, "contact_type") === "mortgage_broker" ? "mortgage_broker" : "realtor",
    fullName: str(formData, "full_name"),
    companyName: str(formData, "company_name"),
    email: str(formData, "email"),
    cellPhone: str(formData, "cell_phone"),
    officePhone: str(formData, "office_phone"),
    licenseNumber: str(formData, "license_number"),
    emailConsent: formData.get("email_consent") === "on",
    smsConsent: formData.get("sms_consent") === "on",
    ip,
  });

  if (result.ok) return { done: true };
  const values: OptInValues = Object.fromEntries(FIELDS.map((f) => [f, str(formData, f)]));
  values.email_consent = formData.get("email_consent") === "on" ? "on" : "";
  values.sms_consent = formData.get("sms_consent") === "on" ? "on" : "";
  return { error: result.error, values };
}
