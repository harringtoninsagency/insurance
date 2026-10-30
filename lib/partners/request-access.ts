import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, ContactType } from "@/lib/types/database";
import { cleanText, normalizeEmail, normalizePersonName, normalizePhone } from "@/lib/contacts/normalize";
import { resolvePublicAgent } from "@/lib/team/team";

// Matches lib/quote-requests/submit.ts's PUBLIC_FORM_AGENCY_ID — this app's one agency.
const PUBLIC_FORM_AGENCY_ID = "ccb0a58e-0b78-4799-b236-66d1bda42f67";

export type AccessRequestResult = { ok: true } | { ok: false; error: string };

/**
 * Public "request access" intake for the partner app — the gated front door
 * from the "Quote app access and front doors" plan, replacing the old open
 * self-signup (lib/partners/self-signup.ts). This only records the request;
 * it never creates a directory contact, an auth user, or any portal access.
 * A producer reviews it, verifies the license number against DBPR (realtors
 * and roofing contractors) or NMLS Consumer Access (mortgage brokers), and
 * approves or denies from app/(dash)/contacts/access-requests — approval is
 * what upserts the contact and runs the existing admin-invite flow
 * (lib/partners/invite.ts), unchanged.
 */
export async function submitAccessRequest(
  supabase: SupabaseClient<Database>,
  input: {
    fullName: string;
    companyName?: string | null;
    email: string;
    phoneDigits: string;
    contactType: ContactType;
    licenseNumber: string;
    buyersPerMonth?: string | null;
    referralPartnerAgentId?: string | null;
  }
): Promise<AccessRequestResult> {
  const fullName = normalizePersonName(input.fullName);
  if (!fullName) return { ok: false, error: "Enter your full name." };

  const email = normalizeEmail(input.email);
  if (!email) return { ok: false, error: "Enter a valid email address." };

  if (!/^\d{10}$/.test(input.phoneDigits)) return { ok: false, error: "Enter a 10-digit phone number (digits only)." };
  const phone = normalizePhone(input.phoneDigits);

  const licenseNumber = cleanText(input.licenseNumber);
  if (!licenseNumber) return { ok: false, error: "Enter your license number — we verify it before approving access." };

  // Re-validated against this agency's active profiles, same as self-signup
  // did — the page-load check in app/partner/signup/page.tsx is only for the
  // friendly "you'll be connected with X" message.
  const resolvedAgent = await resolvePublicAgent(supabase, PUBLIC_FORM_AGENCY_ID, input.referralPartnerAgentId);

  const { error } = await supabase.from("partner_access_requests").insert({
    agency_id: PUBLIC_FORM_AGENCY_ID,
    contact_type: input.contactType,
    full_name: fullName,
    company_name: cleanText(input.companyName),
    email,
    cell_phone: phone,
    license_number: licenseNumber.toUpperCase(),
    buyers_per_month: cleanText(input.buyersPerMonth),
    referral_partner_agent_id: resolvedAgent?.id ?? null,
  });
  if (error) return { ok: false, error: `Couldn't submit your request: ${error.message}` };

  return { ok: true };
}
