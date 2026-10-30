"use server";

import { revalidatePath } from "next/cache";
import { sessionContext } from "@/lib/contacts/session";
import { applyConsentEvent, type ConsentResult } from "@/lib/contacts/consent";
import { upsertContact } from "@/lib/contacts/upsert-contact";
import { importContactsCsv, type ImportSummary } from "@/lib/contacts/import-csv";
import { invitePartner, type InviteResult } from "@/lib/partners/invite";
import { uploadPartnerImage, type BrandingKind } from "@/lib/partners/branding";
import { regeneratePropertiesForContactAgentChange } from "@/lib/proposals/regenerate";
import { createServiceSupabase } from "@/lib/supabase/server";
import { cleanText, normalizeEmail, normalizePersonName, normalizePhone } from "@/lib/contacts/normalize";
import type { ConsentEventType, ConsentMethod, ContactSource, ContactType } from "@/lib/types/database";

// Imports run row-by-row (dedupe lookups per person), so keep one upload
// small enough to finish inside a request; bigger lists go through
// scripts/import-contacts-csv.ts.
const MAX_UI_IMPORT_ROWS = 1000;
const MAX_UI_IMPORT_BYTES = 2 * 1024 * 1024;

const SOURCES: ContactSource[] = ["manual", "csv_import", "listing_agent", "public_license", "referral", "event", "web_form", "other"];

const str = (formData: FormData, key: string) => String(formData.get(key) ?? "").trim();
const asType = (v: string): ContactType =>
  v === "mortgage_broker" ? "mortgage_broker" : v === "roofing_company" ? "roofing_company" : "realtor";

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
      referralPartnerAgentId: str(formData, "referral_partner_agent_id") || null,
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

export async function updateReferralPartnerAgentAction(contactId: string, formData: FormData): Promise<{ ok: true } | { ok: false; error: string }> {
  const agentId = str(formData, "referral_partner_agent_id");
  try {
    const { supabase } = await sessionContext();
    const { error } = await supabase.from("industry_contacts").update({ referral_partner_agent_id: agentId || null }).eq("id", contactId);
    if (error) return { ok: false, error: error.message };
    // Lowest-priority rung in resolveProposalAgent's precedence — only
    // actually matters for this contact's properties that have no agent of
    // their own at the property or request level; see its own doc comment.
    await regeneratePropertiesForContactAgentChange(contactId);
    revalidatePath(`/contacts/${contactId}`);
    revalidatePath("/contacts");
    revalidatePath("/contacts/referral-activity");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to save the referral partner agent." };
  }
}

export interface FollowUpPayload {
  note: string;
  nextFollowUpOn: string;
}

export type FollowUpResult = { ok: true } | { ok: false; error: string };

export async function recordFollowUpAction(contactId: string, payload: FollowUpPayload): Promise<FollowUpResult> {
  try {
    if (!payload.note.trim()) return { ok: false, error: "Add a note about the follow-up." };

    const { supabase, agencyId, userEmail } = await sessionContext();
    const { error } = await supabase.from("contact_follow_ups").insert({
      agency_id: agencyId,
      contact_id: contactId,
      note: payload.note.trim(),
      next_follow_up_on: payload.nextFollowUpOn.trim() || null,
      recorded_by: userEmail,
    });
    if (error) return { ok: false, error: error.message };

    revalidatePath(`/contacts/${contactId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to record the follow-up." };
  }
}

export interface ContactDetailsPayload {
  fullName: string;
  companyName: string;
  cellPhone: string;
  officePhone: string;
  email: string;
  licenseNumber: string;
  city: string;
}

export type ContactDetailsResult = { ok: true } | { ok: false; error: string };

export async function updateContactDetailsAction(contactId: string, payload: ContactDetailsPayload): Promise<ContactDetailsResult> {
  try {
    const fullName = normalizePersonName(payload.fullName);
    if (!fullName) return { ok: false, error: "Name can't be blank." };

    const email = normalizeEmail(payload.email);
    if (payload.email.trim() && !email) return { ok: false, error: `Invalid email "${payload.email.trim()}"` };

    const { supabase } = await sessionContext();
    const { error } = await supabase
      .from("industry_contacts")
      .update({
        full_name: fullName,
        company_name: cleanText(payload.companyName),
        cell_phone: normalizePhone(payload.cellPhone),
        office_phone: normalizePhone(payload.officePhone),
        email,
        license_number: cleanText(payload.licenseNumber)?.toUpperCase() ?? null,
        city: cleanText(payload.city),
        updated_at: new Date().toISOString(),
      })
      .eq("id", contactId);
    if (error) return { ok: false, error: error.message };

    revalidatePath(`/contacts/${contactId}`);
    revalidatePath("/contacts");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to save the contact." };
  }
}

export type ContactBrandingResult = { ok: true } | { ok: false; error: string };

/**
 * Admin-side equivalent of a partner's own uploadPartnerPhotoAction/
 * uploadPartnerLogoAction (app/partner/(portal)/actions.ts) — lets a team
 * member upload a referral partner's co-branding photo or company logo on
 * their behalf (e.g. while onboarding someone who'd rather not log into
 * their own portal), for the same industry_contacts row.
 */
async function uploadContactBrandingAction(kind: BrandingKind, contactId: string, formData: FormData): Promise<ContactBrandingResult> {
  const file = formData.get(kind);
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: `Choose a ${kind === "photo" ? "photo" : "logo"} file first.` };

  try {
    const { agencyId } = await sessionContext();
    const service = createServiceSupabase();
    const bytes = new Uint8Array(await file.arrayBuffer());
    await uploadPartnerImage(kind, agencyId, contactId, bytes, file.type);
    revalidatePath(`/contacts/${contactId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Something went wrong." };
  }
}

export async function uploadContactPhotoAction(contactId: string, _prev: ContactBrandingResult | null, formData: FormData): Promise<ContactBrandingResult> {
  return uploadContactBrandingAction("photo", contactId, formData);
}

export async function uploadContactLogoAction(contactId: string, _prev: ContactBrandingResult | null, formData: FormData): Promise<ContactBrandingResult> {
  return uploadContactBrandingAction("logo", contactId, formData);
}

export type DeleteContactResult = { ok: true } | { ok: false; error: string };

/**
 * Permanently removes a referral partner from the directory. Cascades to
 * their partner-portal account and follow-up notes (contact_follow_ups,
 * partner_accounts — see migrations' FK delete rules); past outreach sends
 * and consent/opt-out events are kept but unlinked (SET NULL) rather than
 * deleted, since those are this agency's own compliance record, not the
 * partner's. Irreversible — the confirm step lives in the button itself.
 *
 * Also deletes their Supabase Auth user, if a partner_accounts row ever
 * linked one — the FK cascade above only removes OUR row, not the
 * auth.users one Supabase Auth owns. Left behind, that auth user keeps the
 * email "already registered" forever: confirmed live that a later re-invite
 * (direct, or via an approved access request — see
 * app/(dash)/contacts/access-requests/actions.ts) for the same email then
 * fails inside invitePartner's own auth.admin.inviteUserByEmail call, with
 * no new partner_accounts row ever created — so the person can authenticate
 * (the orphaned auth user still works) but the portal layout finds no
 * active partner_accounts row for them and immediately signs them back out,
 * which looks like "signed up but can't log in" from their side.
 */
export async function deleteContactAction(contactId: string): Promise<DeleteContactResult> {
  try {
    const { supabase } = await sessionContext();
    const { data: contact } = await supabase
      .from("industry_contacts")
      .select("photo_path, logo_path")
      .eq("id", contactId)
      .single();

    const service = createServiceSupabase();
    const { data: account } = await service.from("partner_accounts").select("user_id").eq("contact_id", contactId).maybeSingle();

    if (contact?.photo_path) await service.storage.from("partner-photos").remove([contact.photo_path]);
    if (contact?.logo_path) await service.storage.from("partner-logos").remove([contact.logo_path]);

    const { error } = await supabase.from("industry_contacts").delete().eq("id", contactId);
    if (error) return { ok: false, error: error.message };

    if (account?.user_id) await service.auth.admin.deleteUser(account.user_id);

    revalidatePath("/contacts");
    revalidatePath("/contacts/referral-activity");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to delete this referral partner." };
  }
}

export async function invitePartnerAction(contactId: string): Promise<InviteResult> {
  try {
    const { agencyId, userEmail } = await sessionContext();
    // inviteUserByEmail needs the service-role client — the signed-in
    // producer's own session (checked above) is what authorizes this action,
    // not what performs it.
    const service = createServiceSupabase();
    const { data: profile } = await service.from("profiles").select("id").eq("email", userEmail).maybeSingle();
    const result = await invitePartner(service, agencyId, contactId, profile?.id ?? null);
    if (result.ok) revalidatePath(`/contacts/${contactId}`);
    return result;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to invite this contact" };
  }
}
