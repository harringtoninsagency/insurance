import type { SupabaseClient } from "@supabase/supabase-js";
import type { ContactType, Database } from "@/lib/types/database";
import { upsertContact } from "@/lib/contacts/upsert-contact";
import { normalizeEmail, normalizePhone } from "@/lib/contacts/normalize";
import { CONSENT_VERSION, EMAIL_CONSENT_TEXT, SMS_CONSENT_TEXT } from "@/lib/contacts/consent-text";

// The public form has no signed-in user, so it can't derive an agency from a
// session. FetchRival serves a single agency; revisit if a second is added.
export const PUBLIC_FORM_AGENCY_ID = "ccb0a58e-0b78-4799-b236-66d1bda42f67";

export interface OptInInput {
  contactType: ContactType;
  fullName: string;
  companyName: string;
  email: string;
  cellPhone: string;
  officePhone: string;
  licenseNumber: string;
  emailConsent: boolean;
  smsConsent: boolean;
  ip: string | null;
}

export type OptInResult = { ok: true } | { ok: false; error: string };

const MAX_FIELD = 200;

/**
 * Records a self-service opt-in. Adds the person to the directory (or
 * enriches their existing row), then stores consent with a timestamp, the
 * wording they agreed to and their IP.
 *
 * Deliberately never re-subscribes anyone who was marked do-not-contact or
 * opted out: this form is unauthenticated, so it can't prove the submitter
 * owns that email address, and an opt-out must win. The caller gets the same
 * "success" either way so the form can't be used to probe who is in the list.
 */
export async function recordOptIn(supabase: SupabaseClient<Database>, input: OptInInput): Promise<OptInResult> {
  const tooLong = [input.fullName, input.companyName, input.email, input.cellPhone, input.officePhone, input.licenseNumber].some(
    (v) => v.length > MAX_FIELD
  );
  if (tooLong) return { ok: false, error: "One of the fields is too long." };
  if (!input.fullName.trim()) return { ok: false, error: "Please enter your name." };

  const email = normalizeEmail(input.email);
  if (!email) return { ok: false, error: "Please enter a valid email address." };
  if (!input.emailConsent) return { ok: false, error: "Please check the box to agree to receive emails." };

  const cell = normalizePhone(input.cellPhone);
  if (input.cellPhone.trim() && !cell) return { ok: false, error: "Please enter a 10-digit cell phone number." };
  if (input.officePhone.trim() && !normalizePhone(input.officePhone)) {
    return { ok: false, error: "Please enter a 10-digit office phone number." };
  }
  if (input.smsConsent && !cell) {
    return { ok: false, error: "Enter your cell number to receive texts, or uncheck the text-message box." };
  }

  const outcome = await upsertContact(supabase, PUBLIC_FORM_AGENCY_ID, {
    contactType: input.contactType,
    fullName: input.fullName,
    companyName: input.companyName,
    cellPhone: input.cellPhone,
    officePhone: input.officePhone,
    email,
    licenseNumber: input.licenseNumber,
    source: "web_form",
    sourceDetail: "Public opt-in page",
  });
  if (outcome.result === "rejected") {
    console.error("Opt-in rejected:", outcome.reason);
    return { ok: false, error: "Something went wrong saving your details. Please try again or email us." };
  }

  const { data: contact } = await supabase
    .from("industry_contacts")
    .select("full_name, do_not_contact, email_consent")
    .eq("id", outcome.id)
    .single();
  if (!contact || contact.do_not_contact || contact.email_consent === "opted_out") return { ok: true };

  const now = new Date().toISOString();
  const consentText = [
    `v${CONSENT_VERSION}`,
    `EMAIL: ${EMAIL_CONSENT_TEXT}`,
    input.smsConsent ? `SMS: ${SMS_CONSENT_TEXT}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  // Log the consent (exact wording and IP as evidence) *before* applying it.
  const events = [
    { event_type: "email_opt_in" as const, consent_text: EMAIL_CONSENT_TEXT, contact_cell: null as string | null },
    ...(input.smsConsent && cell ? [{ event_type: "sms_opt_in" as const, consent_text: SMS_CONSENT_TEXT, contact_cell: cell }] : []),
  ].map((e) => ({
    agency_id: PUBLIC_FORM_AGENCY_ID,
    contact_id: outcome.id,
    contact_name: contact.full_name,
    contact_email: email,
    method: "web_form" as const,
    note: `Public opt-in page, wording v${CONSENT_VERSION}`,
    ip: input.ip,
    occurred_at: now,
    recorded_by: "web form",
    ...e,
  }));
  const { error: eventError } = await supabase.from("contact_consent_events").insert(events);
  if (eventError) {
    // No consent without a record of it: if the history can't be saved, don't grant anything.
    console.error("Opt-in history entry failed:", eventError.message);
    return { ok: false, error: "Something went wrong saving your details. Please try again or email us." };
  }
  const { error } = await supabase
    .from("industry_contacts")
    .update({
      email_consent: "opted_in",
      email_consent_at: now,
      // The number they consented to text is the one they typed here, even
      // if an older, different number was already on file.
      ...(input.smsConsent && cell ? { sms_consent: "written" as const, sms_consent_at: now, cell_phone: cell } : {}),
      consent_text: consentText,
      consent_ip: input.ip,
      last_verified_at: now,
      updated_at: now,
    })
    .eq("id", outcome.id);
  if (error) {
    console.error("Opt-in consent update failed:", error.message);
    return { ok: false, error: "Something went wrong saving your details. Please try again or email us." };
  }

  return { ok: true };
}
