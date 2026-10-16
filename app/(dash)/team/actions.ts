"use server";

import { revalidatePath } from "next/cache";
import { createServiceSupabase } from "@/lib/supabase/server";
import { adminContext, inviteTeamMember, sendPasswordLink, setPersonalEmail, setTeamMemberActive, setTeamMemberRole, type TeamResult } from "@/lib/team/team";
import { uploadAgentPhoto } from "@/lib/proposals/agent-photo";

export type InviteState = { invited: string } | { error: string } | null;

// Every action re-checks admin from the caller's own session — the page
// hiding the controls from producers is a convenience, not the gate.
async function run(fn: (ctx: { agencyId: string; userId: string }) => Promise<TeamResult>): Promise<TeamResult> {
  try {
    const ctx = await adminContext();
    const result = await fn(ctx);
    if (result.ok) revalidatePath("/team");
    return result;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Something went wrong." };
  }
}

export async function inviteTeamMemberAction(_prev: InviteState, formData: FormData): Promise<InviteState> {
  const email = String(formData.get("email") ?? "");
  const result = await run(({ agencyId }) =>
    inviteTeamMember(createServiceSupabase(), agencyId, {
      email,
      fullName: String(formData.get("full_name") ?? ""),
      role: formData.get("role") === "admin" ? "admin" : "producer",
    })
  );
  return result.ok ? { invited: email.trim().toLowerCase() } : { error: result.error };
}

export async function setRoleAction(memberId: string, role: "producer" | "admin"): Promise<TeamResult> {
  return run(({ agencyId, userId }) => setTeamMemberRole(createServiceSupabase(), agencyId, userId, memberId, role));
}

export async function setActiveAction(memberId: string, active: boolean): Promise<TeamResult> {
  return run(({ agencyId, userId }) => setTeamMemberActive(createServiceSupabase(), agencyId, userId, memberId, active));
}

export async function sendPasswordLinkAction(memberId: string): Promise<TeamResult> {
  return run(({ agencyId }) => sendPasswordLink(createServiceSupabase(), agencyId, memberId));
}

export async function setPersonalEmailAction(memberId: string, formData: FormData): Promise<TeamResult> {
  const personalEmail = String(formData.get("personal_email") ?? "").trim();
  return run(({ agencyId }) => setPersonalEmail(createServiceSupabase(), agencyId, memberId, personalEmail || null));
}

export async function uploadAgentPhotoAction(memberId: string, formData: FormData): Promise<TeamResult> {
  const file = formData.get("photo");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose a photo file first." };
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    return await run(async ({ agencyId }) => {
      await uploadAgentPhoto(agencyId, memberId, bytes, file.type);
      return { ok: true };
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to upload the photo." };
  }
}
