"use server";

import { revalidatePath } from "next/cache";
import { sessionContext } from "@/lib/contacts/session";
import { applyConsentEvent, type ConsentResult } from "@/lib/contacts/consent";
import { upsertContact } from "@/lib/contacts/upsert-contact";
import { importContactsCsv, type ImportSummary } from "@/lib/contacts/import-csv";
import type { ConsentEventType, ConsentMethod, ContactSource, ContactType } from "@/lib/types/database";

// Imports run row-by-row (dedupe lookups per person), so keep one upload
// small enough to finish inside a request; bigger lists go through
// scripts/import-contacts-csv.ts.
const MAX_UI_IMPORT_ROWS = 1000;
const MAX_UI_IMPORT_BYTES = 2 * 1024 * 1024;

const SOURCES: ContactSource[] = ["manual", "csv_import", "listing_agent", "public_license", "referral", "event", "web_form", "other"];

const str = (formData: FormData, key: string) => String(formData.get(key) ?? "").trim();
const asType = (v: string): ContactType => (v === "mortgage_broker" ? "mortgage_broker" : "realtor");

export type AddContactState = { added: string } | { updated: string } | { error: string } | null;

export async function addContactAction(_prev: AddContactState, formData: FormData): Promise<AddContactState> {
  try {
    const { supabase, agencyId } = await sessionContext();
    const source = str(formData, "source") as ContactSource;
    const outcome = await upsertContact(supabase, agencyId, {
      contactType: asType(str(formData, "contact_type")),
      fullName: str(formData, "full_name"),
      companyName: str(formData, "company_name"),
      cellPhone: str(formData, "cell_phone"),
      officePhone: str(formData, "office_phone"),
      email: str(formData, "email"),
      licenseNumber: str(formData, "license_number"),
      city: str(formData, "city"),
      source: SOURCES.includes(source) ? source : "manual",
    });
    if (outcome.result === "rejected") return { error: `Not saved: ${outcome.reason}` };
    revalidatePath("/contacts");
    const name = str(formData, "full_name");
    return outcome.result === "inserted" ? { added: name } : { updated: name };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to add contact" };
  }
}

export type ImportState = ({ summary: ImportSummary } & { fileName: string }) | { error: string } | null;

export async function importContactsAction(_prev: ImportState, formData: FormData): Promise<ImportState> {
  try {
    const { supabase, agencyId } = await sessionContext();
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) return { error: "Choose a CSV file first." };
    if (file.size > MAX_UI_IMPORT_BYTES) {
      return { error: "That file is over 2MB. Split it up, or use scripts/import-contacts-csv.ts for large lists." };
    }

    const source = str(formData, "source") as ContactSource;
    const summary = await importContactsCsv(supabase, agencyId, await file.text(), {
      defaultType: asType(str(formData, "contact_type")),
      source: SOURCES.includes(source) ? source : "csv_import",
      sourceDetail: str(formData, "source_detail") || file.name,
      maxRows: MAX_UI_IMPORT_ROWS,
    });
    revalidatePath("/contacts");
    return { summary, fileName: file.name };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Import failed" };
  }
}

// The list's quick "Mark DNC" button. Lifting do-not-contact needs a note
// recording that the person asked, so that lives on the contact's own page.
export async function markDoNotContactAction(contactId: string) {
  const { supabase, userEmail } = await sessionContext();
  const { data: contact, error } = await supabase.from("industry_contacts").select("*").eq("id", contactId).single();
  if (error || !contact) throw new Error(`Contact not found: ${error?.message ?? "no row"}`);
  const result = await applyConsentEvent(supabase, contact, {
    type: "do_not_contact",
    method: "directory",
    note: "Marked from the directory list",
    recordedBy: userEmail,
  });
  if (!result.ok) throw new Error(result.error);
  revalidatePath("/contacts");
  revalidatePath(`/contacts/${contactId}`);
}

export interface RecordConsentPayload {
  type: ConsentEventType;
  method: ConsentMethod;
  note: string;
  occurredOn: string;
  cellPhone: string;
}

const EVENT_TYPES: ConsentEventType[] = ["email_opt_in", "sms_opt_in", "email_opt_out", "sms_opt_out", "do_not_contact", "do_not_contact_cleared"];
const METHODS: ConsentMethod[] = ["paper_form", "written_reply", "verbal"];

// Takes a plain object (not FormData) so the form keeps everything typed in
// when validation fails — React resets uncontrolled form fields after a form action.
export async function recordConsentAction(contactId: string, payload: RecordConsentPayload): Promise<ConsentResult> {
  try {
    if (!EVENT_TYPES.includes(payload.type)) return { ok: false, error: "Choose what the person told you." };
    if (!METHODS.includes(payload.method)) return { ok: false, error: "Choose how you got it." };

    const { supabase, userEmail } = await sessionContext();
    const { data: contact, error } = await supabase.from("industry_contacts").select("*").eq("id", contactId).single();
    if (error || !contact) return { ok: false, error: "Contact not found." };

    const result = await applyConsentEvent(supabase, contact, {
      type: payload.type,
      method: payload.method,
      note: payload.note,
      occurredOn: payload.occurredOn.trim() || null,
      cellPhone: payload.cellPhone.trim() || null,
      recordedBy: userEmail,
    });
    if (result.ok) {
      revalidatePath("/contacts");
      revalidatePath(`/contacts/${contactId}`);
    }
    return result;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to record consent" };
  }
}
