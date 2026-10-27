import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";

type Service = SupabaseClient<Database>;

/**
 * Validates a candidate industry_contacts.id a team member chose to
 * co-brand an internal quote request with (see
 * app/(dash)/quote-requests/new/NewQuoteForm.tsx) — in this agency, and an
 * actual referral-partner type (realtor/mortgage_broker/roofing_company),
 * not some other contact. Mirrors lib/team/team.ts's resolvePublicAgent:
 * a posted id is never trusted on its own, this is the actual
 * authorization boundary.
 */
export async function resolveReferralPartnerContact(
  service: Service,
  agencyId: string,
  contactId: string | null | undefined
): Promise<{ id: string; fullName: string } | null> {
  const trimmed = contactId?.trim();
  if (!trimmed) return null;
  const { data } = await service
    .from("industry_contacts")
    .select("id, full_name")
    .eq("agency_id", agencyId)
    .eq("id", trimmed)
    .in("contact_type", ["realtor", "mortgage_broker", "roofing_company"])
    .maybeSingle();
  return data ? { id: data.id, fullName: data.full_name } : null;
}
