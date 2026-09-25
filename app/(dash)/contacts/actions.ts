"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { upsertContact } from "@/lib/contacts/upsert-contact";
import { importContactsCsv, type ImportSummary } from "@/lib/contacts/import-csv";
import type { ContactSource, ContactType } from "@/lib/types/database";

// Imports run row-by-row (dedupe lookups per person), so keep one upload
// small enough to finish inside a request; bigger lists go through
// scripts/import-contacts-csv.ts.
const MAX_UI_IMPORT_ROWS = 1000;
const MAX_UI_IMPORT_BYTES = 2 * 1024 * 1024;

const SOURCES: ContactSource[] = ["manual", "csv_import", "listing_agent", "public_license", "referral", "event", "web_form", "other"];

async function sessionContext() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  const { data: profile } = await supabase.from("profiles").select("agency_id").eq("id", user.id).single();
  if (!profile) throw new Error("No agency profile for this user");
  return { supabase, agencyId: profile.agency_id };
}

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

export async function setDoNotContactAction(contactId: string, doNotContact: boolean) {
  const { supabase } = await sessionContext();
  const { error } = await supabase
    .from("industry_contacts")
    .update({ do_not_contact: doNotContact, updated_at: new Date().toISOString() })
    .eq("id", contactId);
  if (error) throw new Error(`Failed to update contact: ${error.message}`);
  revalidatePath("/contacts");
}
