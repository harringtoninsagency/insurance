"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase, createServiceSupabase } from "@/lib/supabase/server";
import { submitQuoteRequest, type SubmitQuoteRequestInput } from "@/lib/quote-requests/submit";
import { prepareQuoteRequest } from "@/lib/quote-requests/prepare";
import { fireQuoteRoutine } from "@/lib/quote-requests/fire-routine";
import { notifyReferralPartnerSubmission } from "@/lib/quote-requests/submission-notify";
import { uploadPartnerImage, type BrandingKind } from "@/lib/partners/branding";
import { resolvePublicAgent } from "@/lib/team/team";
import { regeneratePropertiesForContactAgentChange } from "@/lib/proposals/regenerate";

export type PartnerRequestValues = Record<string, string>;
export type PartnerRequestState = { done: { status: string } } | { error: string; values: PartnerRequestValues } | null;

const FIELDS = ["requesterName", "requesterEmail", "requesterPhone", "requestKind", "addressLine", "city", "state", "zipcode", "yearBuilt", "sqft", "beds", "baths", "construction", "listPrice"] as const;

export type PartnerActionResult = { ok: true } | { ok: false; error: string };

/** Every partner-portal write below starts the same way: the caller's own verified active partner account, never trusted from form input. */
async function requirePartnerAccount(): Promise<{ agencyId: string; contactId: string } | { error: string }> {
  const session = await createServerSupabase();
  const {
    data: { user },
  } = await session.auth.getUser();
  if (!user) return { error: "Your session has expired — please sign in again." };

  const service = createServiceSupabase();
  const { data: account } = await service.from("partner_accounts").select("agency_id, contact_id, status").eq("user_id", user.id).maybeSingle();
  if (!account || account.status !== "active") return { error: "Your partner account isn't active. Contact your Brightway representative." };
  return { agencyId: account.agency_id, contactId: account.contact_id };
}

async function uploadPartnerBrandingAction(kind: BrandingKind, formData: FormData): Promise<PartnerActionResult> {
  const file = formData.get(kind);
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: `Choose a ${kind === "photo" ? "photo" : "logo"} file first.` };

  const account = await requirePartnerAccount();
  if ("error" in account) return { ok: false, error: account.error };

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    await uploadPartnerImage(kind, account.agencyId, account.contactId, bytes, file.type);
    revalidatePath("/partner");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Something went wrong." };
  }
}

export async function uploadPartnerPhotoAction(_prev: PartnerActionResult | null, formData: FormData): Promise<PartnerActionResult> {
  return uploadPartnerBrandingAction("photo", formData);
}

export async function uploadPartnerLogoAction(_prev: PartnerActionResult | null, formData: FormData): Promise<PartnerActionResult> {
  return uploadPartnerBrandingAction("logo", formData);
}

/** Lets a partner set/update their own company name — shown alongside their name on every Brightway-generated proposal. Same field an admin edits via EditContactDetailsForm, just self-service. */
export async function updatePartnerCompanyNameAction(_prev: PartnerActionResult | null, formData: FormData): Promise<PartnerActionResult> {
  const account = await requirePartnerAccount();
  if ("error" in account) return { ok: false, error: account.error };

  const companyName = String(formData.get("company_name") ?? "").trim() || null;
  const service = createServiceSupabase();
  const { error } = await service.from("industry_contacts").update({ company_name: companyName }).eq("id", account.contactId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/partner");
  return { ok: true };
}

/** Lets a partner pick/change their own linked Brightway agent — same effect as an admin's ReferralPartnerAgentSelect on /contacts, just self-service. */
export async function updatePartnerAgentAction(_prev: PartnerActionResult | null, formData: FormData): Promise<PartnerActionResult> {
  const account = await requirePartnerAccount();
  if ("error" in account) return { ok: false, error: account.error };

  const rawAgentId = String(formData.get("referral_partner_agent_id") ?? "").trim();
  const service = createServiceSupabase();

  // Re-validated against this partner's own agency's active agents — a
  // posted agent id is never trusted on its own, same check used at signup.
  const resolvedAgent = rawAgentId ? await resolvePublicAgent(service, account.agencyId, rawAgentId) : null;
  if (rawAgentId && !resolvedAgent) return { ok: false, error: "Choose a valid agent from the list." };

  const { error } = await service.from("industry_contacts").update({ referral_partner_agent_id: resolvedAgent?.id ?? null }).eq("id", account.contactId);
  if (error) return { ok: false, error: error.message };

  // Lowest-priority rung in resolveProposalAgent's precedence — only
  // actually matters for this partner's properties that have no agent of
  // their own at the property or request level; see its own doc comment.
  await regeneratePropertiesForContactAgentChange(account.contactId);
  revalidatePath("/partner");
  return { ok: true };
}

const str = (formData: FormData, key: string) => String(formData.get(key) ?? "").trim();

/**
 * The partner-portal version of quote-request submission. contactId always
 * comes from the caller's own verified session — a partner can never submit
 * a request tagged as someone else, no matter what a form field might say.
 */
export async function submitPartnerQuoteRequestAction(_prev: PartnerRequestState, formData: FormData): Promise<PartnerRequestState> {
  const session = await createServerSupabase();
  const {
    data: { user },
  } = await session.auth.getUser();
  if (!user) return { error: "Your session has expired — please sign in again.", values: {} };

  const service = createServiceSupabase();
  const { data: account } = await service.from("partner_accounts").select("agency_id, contact_id, status").eq("user_id", user.id).maybeSingle();
  if (!account || account.status !== "active") return { error: "Your partner account isn't active. Contact your Brightway representative.", values: {} };

  const { data: contact } = await service
    .from("industry_contacts")
    .select("full_name, email, referral_partner_agent_id")
    .eq("id", account.contact_id)
    .single();

  const input: SubmitQuoteRequestInput = {
    requesterType: "partner",
    contactId: account.contact_id,
    // Set once at signup (self-signup via an agent's share link, or an
    // admin's /contacts edit) and carried onto every request this partner
    // submits from here on — see lib/team/team.ts's resolvePublicAgent.
    assignedAgentId: contact?.referral_partner_agent_id ?? null,
    // A partner's own directory identity is the requester, but let them
    // override the email/phone a lead should actually reach (e.g. their own
    // preferred inbox) rather than forcing whatever's on file.
    requesterName: contact?.full_name ?? "Partner",
    requesterEmail: str(formData, "requesterEmail") || contact?.email || "",
    requesterPhone: str(formData, "requesterPhone"),
    requestKind: str(formData, "requestKind") as SubmitQuoteRequestInput["requestKind"],
    addressLine: str(formData, "addressLine"),
    city: str(formData, "city"),
    state: str(formData, "state") || "FL",
    zipcode: str(formData, "zipcode"),
    yearBuilt: str(formData, "yearBuilt"),
    sqft: str(formData, "sqft"),
    beds: str(formData, "beds"),
    baths: str(formData, "baths"),
    construction: str(formData, "construction"),
    listPrice: str(formData, "listPrice"),
    // The form's second CTA submits intent=roof_scenario via its own
    // button's name/value (see NewRequestForm.tsx) — an explicit,
    // partner-chosen ask, independent of the automatic roofing_company
    // contact-type detection in fetch-pipeline.ts (either can trigger it).
    roofScenario: str(formData, "intent") === "roof_scenario",
  };

  const result = await submitQuoteRequest(service, input);
  if (!result.ok) {
    const values = Object.fromEntries(FIELDS.map((f) => [f, str(formData, f)]));
    return { error: result.error, values };
  }

  await notifyReferralPartnerSubmission({
    partnerName: input.requesterName,
    partnerEmail: contact?.email || input.requesterEmail,
    addressLine: input.addressLine,
    city: input.city,
    state: input.state || "FL",
    requestKind: input.requestKind,
  });

  const prep = await prepareQuoteRequest(result.id);
  // Matches the internal "Run quote now" flow (app/(dash)/quote-requests/actions.ts):
  // nudge the quoting routine to run within seconds instead of waiting for its
  // hourly schedule. Never throws, and a failed fire still leaves the request
  // queued for the hourly run — see lib/quote-requests/fire-routine.ts.
  if (prep.status === "processing") {
    await fireQuoteRoutine(result.id);
  }
  revalidatePath("/partner");
  return { done: { status: prep.status } };
}
