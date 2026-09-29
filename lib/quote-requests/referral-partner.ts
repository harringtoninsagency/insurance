import { createServiceSupabase } from "@/lib/supabase/server";

export interface ReferralPartnerInfo {
  name: string;
  companyName: string | null;
  phone: string | null;
  email: string;
}

/**
 * Resolves the realtor/mortgage broker to credit on a generated proposal,
 * for a quote_requests row. Deliberately returns null for a public
 * (self-service) submission, not just a bare-bones version of this info: a
 * buyer requesting their own quote isn't a "referral," so no attribution
 * block should render at all in that case — see the caller in
 * lib/proposals/generate-indication.ts / generate-listing-snapshot.ts. Also
 * null when there's no quote_request behind the proposal at all (every
 * manually-run quote in this app before the partner portal existed).
 *
 * The directory record (industry_contacts), not the request's own captured
 * requester_name/email, is the source of truth here — it's the partner's
 * standing professional identity, which the portal's submit action already
 * copies onto the request at submission time but could drift from later.
 */
export async function resolveReferralPartner(quoteRequestId: string | null | undefined): Promise<ReferralPartnerInfo | null> {
  if (!quoteRequestId) return null;

  const supabase = createServiceSupabase();
  const { data: request } = await supabase.from("quote_requests").select("contact_id, requester_email").eq("id", quoteRequestId).maybeSingle();
  if (!request?.contact_id) return null;

  const { data: contact } = await supabase
    .from("industry_contacts")
    .select("full_name, company_name, cell_phone, office_phone, email")
    .eq("id", request.contact_id)
    .maybeSingle();
  if (!contact) return null;

  return {
    name: contact.full_name,
    companyName: contact.company_name,
    // A referral partner's cell is the more useful callback number when both
    // are on file; office is the fallback, not the other way around.
    phone: contact.cell_phone ?? contact.office_phone,
    email: contact.email ?? request.requester_email,
  };
}
