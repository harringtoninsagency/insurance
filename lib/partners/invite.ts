import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";

// Matches lib/email/config.ts's default — this app's one deployed origin.
const DEFAULT_BASE_URL = "https://insurance-rust-five.vercel.app";

export type InviteResult = { ok: true } | { ok: false; error: string };

/**
 * Invites a directory contact into the partner portal. Uses Supabase Auth's
 * own invite flow (auth.admin.inviteUserByEmail) rather than a custom token
 * system: it creates the auth.users row and emails the person a link that
 * lets them set their own password, landing on /partner/accept-invite. That
 * page finishes the job by flipping this partner_accounts row to 'active'.
 *
 * Whether the email actually arrives depends on this Supabase project's Auth
 * email configuration (its own SMTP, or the shared default sender) — not
 * something this function can confirm on its own.
 *
 * Must be called with the service-role client — auth.admin.* requires it.
 */
export async function invitePartner(supabase: SupabaseClient<Database>, agencyId: string, contactId: string, invitedBy: string | null): Promise<InviteResult> {
  const { data: contact } = await supabase.from("industry_contacts").select("full_name, email, contact_type, do_not_contact").eq("id", contactId).maybeSingle();
  if (!contact) return { ok: false, error: "Contact not found." };
  if (!contact.email) return { ok: false, error: `${contact.full_name} has no email on file — add one before inviting them.` };
  if (contact.do_not_contact) return { ok: false, error: `${contact.full_name} is marked do-not-contact.` };

  const { data: existing } = await supabase.from("partner_accounts").select("id, status").eq("contact_id", contactId).maybeSingle();
  if (existing?.status === "active") return { ok: false, error: `${contact.full_name} already has an active partner account.` };

  const baseUrl = (process.env.APP_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");

  if (!existing) {
    const { error: insertError } = await supabase.from("partner_accounts").insert({
      agency_id: agencyId,
      contact_id: contactId,
      status: "invited",
      invited_by: invitedBy,
    });
    if (insertError) return { ok: false, error: `Couldn't create the partner account: ${insertError.message}` };
  } else {
    await supabase.from("partner_accounts").update({ invited_by: invitedBy, invited_at: new Date().toISOString() }).eq("id", existing.id);
  }

  const { error: inviteError } = await supabase.auth.admin.inviteUserByEmail(contact.email, {
    redirectTo: `${baseUrl}/partner/accept-invite`,
  });
  if (inviteError) return { ok: false, error: `Couldn't send the invite email: ${inviteError.message}` };

  return { ok: true };
}
