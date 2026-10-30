"use server";

import { revalidatePath } from "next/cache";
import { sessionContext } from "@/lib/contacts/session";
import { upsertContact } from "@/lib/contacts/upsert-contact";
import { invitePartner, type InviteResult } from "@/lib/partners/invite";
import { createServiceSupabase } from "@/lib/supabase/server";

export type ReviewResult = { ok: true } | { ok: false; error: string };

/**
 * Approves a pending partner access request: verifying the license is the
 * producer's own step (DBPR for realtors/roofing contractors, NMLS Consumer
 * Access for mortgage brokers — see app/partner/signup's form copy), done
 * before clicking this. Approval upserts the directory contact from the
 * request's own details, then runs the existing admin-invite flow
 * (lib/partners/invite.ts) unchanged — same account-provisioning path as
 * inviting any other contact from their detail page.
 */
export async function approveAccessRequestAction(requestId: string): Promise<ReviewResult> {
  try {
    const { agencyId, userEmail } = await sessionContext();
    const service = createServiceSupabase();

    const { data: request, error: readError } = await service.from("partner_access_requests").select("*").eq("id", requestId).eq("agency_id", agencyId).single();
    if (readError || !request) return { ok: false, error: "Request not found." };
    if (request.status !== "pending") return { ok: false, error: `This request was already ${request.status}.` };

    const { data: reviewer } = await service.from("profiles").select("id").eq("email", userEmail).maybeSingle();

    const outcome = await upsertContact(service, agencyId, {
      contactType: request.contact_type,
      fullName: request.full_name,
      companyName: request.company_name,
      email: request.email,
      cellPhone: request.cell_phone,
      licenseNumber: request.license_number,
      referralPartnerAgentId: request.referral_partner_agent_id,
      source: "web_form",
      sourceDetail: "Partner access request",
    });
    if (outcome.result === "rejected") return { ok: false, error: `Couldn't save the contact: ${outcome.reason}` };

    const inviteResult = await invitePartner(service, agencyId, outcome.id, reviewer?.id ?? null);
    if (!inviteResult.ok) return { ok: false, error: inviteResult.error };

    const { error: updateError } = await service
      .from("partner_access_requests")
      .update({ status: "approved", contact_id: outcome.id, reviewed_by: reviewer?.id ?? null, reviewed_at: new Date().toISOString() })
      .eq("id", requestId);
    if (updateError) return { ok: false, error: `Invited, but couldn't mark the request reviewed: ${updateError.message}` };

    revalidatePath("/contacts/access-requests");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to approve this request." };
  }
}

export async function denyAccessRequestAction(requestId: string, reason: string): Promise<ReviewResult> {
  try {
    const { agencyId, userEmail } = await sessionContext();
    const service = createServiceSupabase();
    const { data: reviewer } = await service.from("profiles").select("id").eq("email", userEmail).maybeSingle();

    const { data: request } = await service.from("partner_access_requests").select("status").eq("id", requestId).eq("agency_id", agencyId).single();
    if (!request) return { ok: false, error: "Request not found." };
    if (request.status !== "pending") return { ok: false, error: `This request was already ${request.status}.` };

    const { error } = await service
      .from("partner_access_requests")
      .update({ status: "denied", status_detail: reason.trim() || null, reviewed_by: reviewer?.id ?? null, reviewed_at: new Date().toISOString() })
      .eq("id", requestId);
    if (error) return { ok: false, error: error.message };

    revalidatePath("/contacts/access-requests");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to deny this request." };
  }
}
