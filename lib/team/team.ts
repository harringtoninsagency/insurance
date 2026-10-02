import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerSupabase } from "@/lib/supabase/server";
import type { Database } from "@/lib/types/database";

type Service = SupabaseClient<Database>;
type Role = "producer" | "admin";

const DEFAULT_BASE_URL = "https://insurance-rust-five.vercel.app";
// Supabase treats ban_duration as a Go duration; this is "effectively forever".
const BAN_FOREVER = "876000h";

export type TeamResult = { ok: true } | { ok: false; error: string };

function baseUrl(): string {
  return (process.env.APP_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

/**
 * The signed-in user's identity, only if they're an active agency admin.
 * Reads through the caller's own RLS-scoped session (the "read own" policy),
 * so a deactivated or non-admin session fails here rather than being trusted
 * from anything the browser sent.
 */
export async function adminContext(): Promise<{ agencyId: string; userId: string }> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");
  const { data: profile } = await supabase.from("profiles").select("agency_id, role, active").eq("id", user.id).maybeSingle();
  if (!profile || !profile.active || profile.role !== "admin") {
    throw new Error("Only agency admins can manage the team.");
  }
  return { agencyId: profile.agency_id, userId: user.id };
}

export interface TeamMember {
  id: string;
  email: string;
  fullName: string | null;
  role: Role;
  active: boolean;
  /** True until the person has signed in once — i.e. the invite is still unused. */
  invitePending: boolean;
}

export async function listTeam(service: Service, agencyId: string): Promise<TeamMember[]> {
  const { data: profiles, error } = await service
    .from("profiles")
    .select("id, email, full_name, role, active, created_at")
    .eq("agency_id", agencyId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Couldn't load the team: ${error.message}`);

  // A small office: one page of auth users is plenty, and it's the only place
  // that knows whether an invite was ever used.
  const { data: authList } = await service.auth.admin.listUsers({ page: 1, perPage: 200 });
  const signedIn = new Map((authList?.users ?? []).map((u) => [u.id, !!u.last_sign_in_at]));

  return (profiles ?? []).map((p) => ({
    id: p.id,
    email: p.email,
    fullName: p.full_name,
    role: p.role,
    active: p.active,
    invitePending: !signedIn.get(p.id),
  }));
}

async function activeAdminCount(service: Service, agencyId: string): Promise<number> {
  const { count } = await service
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("agency_id", agencyId)
    .eq("role", "admin")
    .eq("active", true);
  return count ?? 0;
}

/**
 * Invites someone into the workspace. Uses Supabase Auth's own invite flow
 * (same approach as lib/partners/invite.ts): it creates the auth user and
 * emails a link that lets them choose their own password, landing on
 * /set-password. The profiles row is created right away — not on acceptance —
 * because app/(dash)/layout.tsx treats any signed-in user without one as a
 * partner and bounces them out.
 *
 * Whether the email actually arrives depends on this Supabase project's Auth
 * email setup (its own SMTP, or the shared default sender — which is heavily
 * rate-limited) and on /set-password being in its redirect allow-list; this
 * function can't confirm either.
 */
export async function inviteTeamMember(
  service: Service,
  agencyId: string,
  input: { email: string; fullName: string; role: Role }
): Promise<TeamResult> {
  const email = input.email.trim().toLowerCase();
  const fullName = input.fullName.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "Enter a valid email address." };
  if (!fullName) return { ok: false, error: "Enter the person's name." };

  const { data: existing } = await service.from("profiles").select("id, active").eq("email", email).maybeSingle();
  if (existing) {
    return {
      ok: false,
      error: existing.active ? `${email} is already on the team.` : `${email} was deactivated — reactivate them instead of re-inviting.`,
    };
  }

  const { data, error: inviteError } = await service.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${baseUrl()}/set-password`,
    data: { full_name: fullName },
  });
  if (inviteError || !data.user) {
    return { ok: false, error: `Couldn't send the invite email: ${inviteError?.message ?? "no user returned"}` };
  }

  const { error: insertError } = await service.from("profiles").insert({
    id: data.user.id,
    agency_id: agencyId,
    email,
    full_name: fullName,
    role: input.role,
    active: true,
  });
  if (insertError) {
    // Don't leave an auth user (and a live invite link) with no profile behind.
    await service.auth.admin.deleteUser(data.user.id);
    return { ok: false, error: `Couldn't create the team member: ${insertError.message}` };
  }
  return { ok: true };
}

export async function setTeamMemberRole(service: Service, agencyId: string, actingUserId: string, memberId: string, role: Role): Promise<TeamResult> {
  const { data: member } = await service.from("profiles").select("role, active").eq("id", memberId).eq("agency_id", agencyId).maybeSingle();
  if (!member) return { ok: false, error: "Team member not found." };
  if (member.role === role) return { ok: true };
  if (member.role === "admin" && member.active && (await activeAdminCount(service, agencyId)) <= 1) {
    return { ok: false, error: "There must be at least one active admin — make someone else an admin first." };
  }
  if (memberId === actingUserId && role !== "admin" && (await activeAdminCount(service, agencyId)) <= 1) {
    return { ok: false, error: "You're the only admin." };
  }
  const { error } = await service.from("profiles").update({ role }).eq("id", memberId).eq("agency_id", agencyId);
  return error ? { ok: false, error: error.message } : { ok: true };
}

/**
 * Deactivating does two things: flips profiles.active (which current_agency_id()
 * folds in, so RLS stops returning them any data immediately, even on a still-
 * valid session) and bans the auth user so they can't sign in or refresh.
 */
export async function setTeamMemberActive(service: Service, agencyId: string, actingUserId: string, memberId: string, active: boolean): Promise<TeamResult> {
  const { data: member } = await service.from("profiles").select("role, active").eq("id", memberId).eq("agency_id", agencyId).maybeSingle();
  if (!member) return { ok: false, error: "Team member not found." };
  if (!active) {
    if (memberId === actingUserId) return { ok: false, error: "You can't deactivate your own account." };
    if (member.role === "admin" && member.active && (await activeAdminCount(service, agencyId)) <= 1) {
      return { ok: false, error: "There must be at least one active admin." };
    }
  }
  const { error } = await service.from("profiles").update({ active }).eq("id", memberId).eq("agency_id", agencyId);
  if (error) return { ok: false, error: error.message };
  const { error: banError } = await service.auth.admin.updateUserById(memberId, { ban_duration: active ? "none" : BAN_FOREVER });
  if (banError) return { ok: false, error: `Saved, but couldn't update their sign-in access: ${banError.message}` };
  return { ok: true };
}

/** Emails a password-set/reset link — also how an unused invite is re-sent. */
export async function sendPasswordLink(service: Service, agencyId: string, memberId: string): Promise<TeamResult> {
  const { data: member } = await service.from("profiles").select("email, active").eq("id", memberId).eq("agency_id", agencyId).maybeSingle();
  if (!member) return { ok: false, error: "Team member not found." };
  if (!member.active) return { ok: false, error: "That account is deactivated." };
  const { error } = await service.auth.resetPasswordForEmail(member.email, { redirectTo: `${baseUrl()}/set-password` });
  return error ? { ok: false, error: `Couldn't send the email: ${error.message}` } : { ok: true };
}
