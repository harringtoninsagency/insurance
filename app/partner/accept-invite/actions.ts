"use server";

import { createServerSupabase, createServiceSupabase } from "@/lib/supabase/server";

export type ActivateResult = { ok: true } | { ok: false; error: string };

/**
 * Finalizes a partner_accounts row (invited -> active) once the invited
 * person has set a password. Called right after supabase.auth.updateUser
 * succeeds, so `session` already reflects their newly authenticated user.
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

  const { data: account, error } = await service
    .from("partner_accounts")
    .select("id, status")
    .is("user_id", null)
    .eq("contact_id", contact.id)
    .maybeSingle();
  if (error) return { ok: false, error: "Something went wrong activating your account." };
  if (!account) return { ok: false, error: "No pending invitation was found for this email." };

  const { error: updateError } = await service
    .from("partner_accounts")
    .update({ user_id: user.id, status: "active", activated_at: new Date().toISOString() })
    .eq("id", account.id);
  if (updateError) return { ok: false, error: "Something went wrong activating your account." };

  return { ok: true };
}
