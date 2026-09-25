import type { SupabaseClient } from "@supabase/supabase-js";
import type { ConsentEventType, ConsentMethod, Database } from "@/lib/types/database";
import { normalizePhone } from "@/lib/contacts/normalize";

type Client = SupabaseClient<Database>;
type ContactRow = Database["public"]["Tables"]["industry_contacts"]["Row"];

export const EVENT_LABEL: Record<ConsentEventType, string> = {
  email_opt_in: "Agreed to receive emails",
  sms_opt_in: "Agreed to receive text messages",
  email_opt_out: "Opted out of emails",
  sms_opt_out: "Opted out of text messages",
  do_not_contact: "Marked do not contact",
  do_not_contact_cleared: "Do-not-contact lifted",
};

export const METHOD_LABEL: Record<ConsentMethod, string> = {
  web_form: "Online form",
  paper_form: "Signed form / sign-in sheet",
  written_reply: "Written reply (email or text)",
  verbal: "Verbal (in person or by phone)",
  directory: "Directory",
};

// Marketing texts need prior express *written* consent, so a verbal yes is not
// enough to switch text consent on. Email consent has no such restriction.
export const WRITTEN_METHODS: ConsentMethod[] = ["web_form", "paper_form", "written_reply"];

export interface ConsentInput {
  type: ConsentEventType;
  method: ConsentMethod;
  note?: string | null;
  /** YYYY-MM-DD the person actually agreed/opted out (e.g. the date on a paper form). Defaults to now. */
  occurredOn?: string | null;
  /** Cell number they agreed to be texted on (sms_opt_in only). Defaults to the number on file. */
  cellPhone?: string | null;
  recordedBy: string | null;
  ip?: string | null;
  consentText?: string | null;
}

export type ConsentResult = { ok: true; message: string } | { ok: false; error: string };

/**
 * Applies one consent change to a contact and logs it. Updates the contact's
 * current state, then appends the event that explains why. Rules enforced here
 * (not just in the form) so no caller can skip them:
 *   - text consent needs a written method, a valid cell number and a note
 *     pointing at the evidence;
 *   - lifting do-not-contact, or opting someone back in after an opt-out,
 *     needs a note recording that they asked;
 *   - do-not-contact is total: it also opts the person out of email and text.
 */
export async function applyConsentEvent(supabase: Client, contact: ContactRow, input: ConsentInput): Promise<ConsentResult> {
  const note = input.note?.trim() || null;

  let occurredAt = new Date();
  if (input.occurredOn) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.occurredOn)) return { ok: false, error: "Enter the date as YYYY-MM-DD." };
    occurredAt = new Date(`${input.occurredOn}T12:00:00Z`);
    if (Number.isNaN(occurredAt.getTime())) return { ok: false, error: "That date isn't valid." };
    if (occurredAt.getTime() > Date.now() + 24 * 3600 * 1000) return { ok: false, error: "The date can't be in the future." };
  }
  const occurredIso = occurredAt.toISOString();
  const nowIso = new Date().toISOString();

  const patch: Partial<ContactRow> = { updated_at: nowIso };
  let cellForEvent: string | null = null;
  let message: string;

  switch (input.type) {
    case "email_opt_in": {
      if (!contact.email) return { ok: false, error: "This contact has no email address on file." };
      if (contact.email_consent === "opted_out" && !note) {
        return { ok: false, error: "This person previously opted out. Add a note recording that they asked to be emailed again." };
      }
      patch.email_consent = "opted_in";
      patch.email_consent_at = occurredIso;
      patch.last_verified_at = nowIso;
      message = contact.do_not_contact
        ? "Email consent recorded, but they're still marked do-not-contact — lift that first if they want to hear from you."
        : "Email consent recorded.";
      break;
    }
    case "sms_opt_in": {
      if (!WRITTEN_METHODS.includes(input.method)) {
        return { ok: false, error: "Text marketing needs written consent — a verbal yes isn't enough. Get a signed form or a written reply first." };
      }
      const cell = normalizePhone(input.cellPhone ?? contact.cell_phone);
      if (!cell) return { ok: false, error: "Enter the 10-digit cell number they agreed to be texted on." };
      if (!note) return { ok: false, error: "Add a note saying where the written consent is (e.g. 'sign-in sheet from the Sept 20 expo, in the events binder')." };
      patch.sms_consent = "written";
      patch.sms_consent_at = occurredIso;
      patch.cell_phone = cell;
      patch.last_verified_at = nowIso;
      cellForEvent = cell;
      message = contact.do_not_contact
        ? "Text consent recorded, but they're still marked do-not-contact — lift that first if they want to hear from you."
        : "Text consent recorded.";
      break;
    }
    case "email_opt_out":
      patch.email_consent = "opted_out";
      patch.email_consent_at = occurredIso;
      message = "Recorded. They won't be emailed.";
      break;
    case "sms_opt_out":
      patch.sms_consent = "none";
      patch.sms_consent_at = null;
      message = "Recorded. They won't be texted.";
      break;
    case "do_not_contact":
      patch.do_not_contact = true;
      patch.email_consent = "opted_out";
      patch.email_consent_at = occurredIso;
      patch.sms_consent = "none";
      patch.sms_consent_at = null;
      message = "Marked do-not-contact. No email or text outreach will go to them.";
      break;
    case "do_not_contact_cleared":
      if (!note) return { ok: false, error: "Add a note recording that they asked to hear from you again." };
      patch.do_not_contact = false;
      message = "Do-not-contact lifted. Record their email/text consent separately if they've agreed to it.";
      break;
  }

  const event = {
    agency_id: contact.agency_id,
    contact_id: contact.id,
    contact_name: contact.full_name,
    contact_email: contact.email,
    contact_cell: cellForEvent ?? contact.cell_phone,
    event_type: input.type,
    method: input.method,
    note,
    consent_text: input.consentText ?? null,
    ip: input.ip ?? null,
    occurred_at: occurredIso,
    recorded_by: input.recordedBy,
  };

  // Ordering is deliberate. Anything that *grants* permission is logged first
  // and never applied if the log fails — no consent without a record of it.
  // Anything that *withdraws* permission is applied first, so an opt-out takes
  // effect even if logging hiccups (the failure is reported, not hidden).
  const grantsPermission = input.type === "email_opt_in" || input.type === "sms_opt_in" || input.type === "do_not_contact_cleared";

  if (grantsPermission) {
    const { error: eventError } = await supabase.from("contact_consent_events").insert(event);
    if (eventError) return { ok: false, error: `Nothing was changed: the history entry couldn't be saved (${eventError.message}).` };
    const { error: updateError } = await supabase.from("industry_contacts").update(patch).eq("id", contact.id);
    if (updateError) {
      return { ok: false, error: `The history entry was saved but the contact wasn't updated (${updateError.message}). Try again.` };
    }
    return { ok: true, message };
  }

  const { error: updateError } = await supabase.from("industry_contacts").update(patch).eq("id", contact.id);
  if (updateError) return { ok: false, error: `Couldn't save: ${updateError.message}` };
  const { error: eventError } = await supabase.from("contact_consent_events").insert(event);
  if (eventError) {
    return { ok: true, message: `${message} (Warning: the history entry couldn't be saved — ${eventError.message}.)` };
  }
  return { ok: true, message };
}
