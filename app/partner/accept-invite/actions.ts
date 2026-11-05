"use server";

import { createServerSupabase, createServiceSupabase } from "@/lib/supabase/server";

export type ActivateResult = { ok: true } | { ok: false; error: string };

/**
 * Finalizes a partner_accounts row (invited -> active) once the invited
 * person has set a password. Called right after supabase.auth.updateUser
 * succeeds, so `session` already reflects their newly authenticated user.
 *
 * Deliberately idempotent and not gated on which page the password was set
 * from: a partner only reaches /partner/accept-invite when their one-time
 * invite link is still unused. Anything that consumes that link before they
 * click it themselves (a corporate email security scanner prefetching the
 * URL is the common case) or a double-click of the link sends them to the
 * generic /set-password "link expired, use Forgot password" fallback
 * instead — a real, working password-reset flow that otherwise never ran
 * this activation step, permanently stranding them: signed in fine, but
 * bounced straight back to /partner/login because partner_accounts.user_id
 * was never linked (confirmed in production against John Blevins' account,
 * Nov 2026). Calling this from /set-password too (see that page) closes the
 * gap regardless of which route actually set the password.
 */
export async function activatePartnerAccountAction(): Promise<ActivateResult> {
  const session = await createServerSupabase();
  const {
    data: { user },
  } = await session.auth.getUser();
  if (!user?.email) return { ok: false, error: "Your session has expired. Please use the invite link again." };

  const service = createServiceSupabase();

  // Resolve the invited contact by the email the invite was sent to — the
  // partner_accounts row is created before any auth user exists, so contact
  // email is the only link back to it at this point.
  const { data: contact } = await service.from("industry_contacts").select("id").ilike("email", user.email).maybeSingle();
  if (!contact) return { ok: false, error: "No pending invitation was found for this email." };

  // One row per (agency, contact) — not filtered by user_id so an
  // already-activated or previously-stranded account is handled below
  // instead of reporting "no pending invitation" on every later login.
  const { data: account, error } = await service
    .from("partner_accounts")
    .select("id, status, user_id")
    .eq("contact_id", contact.id)
    .maybeSingle();
  if (error) return { ok: false, error: "Something went wrong activating your account." };
  if (!account) return { ok: false, error: "No pending invitation was found for this email." };

  if (account.user_id === user.id && account.status === "active") return { ok: true };
  if (account.user_id && account.user_id !== user.id) {
    return { ok: false, error: "This invitation is already linked to a different account. Contact your Brightway representative." };
  }

  const { error: updateError } = await service
    .from("partner_accounts")
    .update({ user_id: user.id, status: "active", activated_at: new Date().toISOString() })
    .eq("id", account.id);
  if (updateError) return { ok: false, error: "Something went wrong activating your account." };

  return { ok: true };
}
