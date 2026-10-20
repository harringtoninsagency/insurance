import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, ContactType } from "@/lib/types/database";
import { upsertContact } from "@/lib/contacts/upsert-contact";
import { normalizeEmail, normalizePersonName } from "@/lib/contacts/normalize";
import { resolvePublicAgent } from "@/lib/team/team";

// Matches lib/quote-requests/submit.ts's PUBLIC_FORM_AGENCY_ID — this app's
// one agency, for the other unauthenticated-form flow.
const PUBLIC_FORM_AGENCY_ID = "ccb0a58e-0b78-4799-b236-66d1bda42f67";

export type SelfSignupResult = { ok: true } | { ok: false; error: string };

/**
 * Self-service partner signup: a realtor/mortgage broker creates their own
 * account with name + email + a 10-digit phone number, no admin invite
 * needed — unlike lib/partners/invite.ts's admin-triggered flow, which this
 * sits alongside rather than replaces (an admin can still invite someone
 * directly; this is the other door in).
 *
 * The login password IS the 10-digit phone number (digits only, e.g.
 * "7275551234"), by explicit instruction — flagged as a real tradeoff since
 * a phone number isn't secret, but that's the design asked for here. Pass it
 * as `phoneDigits`, already validated to exactly 10 digits by the caller.
 *
 * Must be called with the service-role client: auth.admin.createUser
 * requires it, same as invitePartner.
 */
export async function signUpPartner(
  supabase: SupabaseClient<Database>,
  input: {
    fullName: string;
    email: string;
    phoneDigits: string;
    contactType: ContactType;
    /** The agent.id off a per-agent share link's `?agent=` param, if the signup form carried one — re-validated here, never trusted from the hidden field alone. */
    referralPartnerAgentId?: string | null;
  }
): Promise<SelfSignupResult> {
  const fullName = normalizePersonName(input.fullName);
  if (!fullName) return { ok: false, error: "Enter your full name." };

  const email = normalizeEmail(input.email);
  if (!email) return { ok: false, error: "Enter a valid email address." };

  if (!/^\d{10}$/.test(input.phoneDigits)) return { ok: false, error: "Enter a 10-digit phone number (digits only)." };

  // Re-validated against this agency's active profiles — the actual
  // authorization boundary for referral_partner_agent_id. The page-load
  // check in app/partner/signup/page.tsx is only for the friendly "you'll
  // be connected with X" message; it isn't trusted on its own here.
  const resolvedAgent = await resolvePublicAgent(supabase, PUBLIC_FORM_AGENCY_ID, input.referralPartnerAgentId);

  // Reuses the same matching logic as every other contact-creation path
  // (by email, then license, then name+company) so a self-signup links up
  // with an existing directory entry (e.g. imported from a DBPR license
  // file) instead of creating a duplicate. upsertContact only fills a blank
  // referral_partner_agent_id — an existing contact's agent assignment is
  // never overwritten by a later signup attempt.
  const outcome = await upsertContact(supabase, PUBLIC_FORM_AGENCY_ID, {
    contactType: input.contactType,
    fullName,
    email,
    cellPhone: input.phoneDigits,
    referralPartnerAgentId: resolvedAgent?.id ?? null,
    source: "web_form",
    sourceDetail: "Partner portal self-signup",
  });
  if (outcome.result === "rejected") return { ok: false, error: `Couldn't save your contact info: ${outcome.reason}` };
  const contactId = outcome.id;

  const { data: existingAccount } = await supabase.from("partner_accounts").select("id, status").eq("contact_id", contactId).maybeSingle();
  if (existingAccount?.status === "active") {
    return { ok: false, error: "An account already exists for this email. Try logging in instead." };
  }

  const { data: created, error: createError } = await supabase.auth.admin.createUser({
    email,
    password: input.phoneDigits,
    email_confirm: true,
  });
  if (createError || !created.user) {
    const message = createError?.message ?? "";
    if (/already registered|already exists/i.test(message)) {
      return { ok: false, error: "An account already exists for this email. Try logging in instead." };
    }
    return { ok: false, error: `Couldn't create your account: ${message || "unknown error"}` };
  }

  const activatedAt = new Date().toISOString();
  if (existingAccount) {
    const { error: updateError } = await supabase
      .from("partner_accounts")
      .update({ user_id: created.user.id, status: "active", activated_at: activatedAt })
      .eq("id", existingAccount.id);
    if (updateError) return { ok: false, error: `Account created, but activation failed: ${updateError.message}` };
  } else {
    const { error: insertError } = await supabase.from("partner_accounts").insert({
      agency_id: PUBLIC_FORM_AGENCY_ID,
      contact_id: contactId,
      user_id: created.user.id,
      status: "active",
      activated_at: activatedAt,
    });
    if (insertError) return { ok: false, error: `Account created, but activation failed: ${insertError.message}` };
  }

  return { ok: true };
}
