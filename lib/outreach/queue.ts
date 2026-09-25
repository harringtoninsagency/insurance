import { createServiceSupabase } from "@/lib/supabase/server";
import { checkRecipient } from "@/lib/outreach/check-recipient";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class SuppressedRecipientError extends Error {}

/**
 * Queues an outreach item for producer review. Runs the recipient through the
 * shared gate first (suppression list, then the realtor/broker directory's
 * do-not-contact and opt-out flags) — a blocked recipient is refused, not
 * silently dropped, so the producer knows why nothing was queued. If the
 * recipient is in the directory the item is linked to that contact.
 */
export async function queueOutreach(
  agencyId: string,
  proposalId: string,
  recipient: string
): Promise<{ id: string; contactId: string | null }> {
  const trimmed = recipient.trim().toLowerCase();
  if (!EMAIL_RE.test(trimmed)) {
    throw new Error(`"${recipient}" doesn't look like a valid email address`);
  }

  const supabase = createServiceSupabase();

  const check = await checkRecipient(supabase, agencyId, trimmed);
  if (!check.allowed) throw new SuppressedRecipientError(check.reason);

  const contactId = check.contact?.id ?? null;
  const { data, error } = await supabase
    .from("outreach")
    .insert({ agency_id: agencyId, proposal_id: proposalId, recipient: trimmed, contact_id: contactId, status: "pending_review" })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`Failed to queue outreach: ${error?.message ?? "no row returned"}`);
  }

  return { id: data.id, contactId };
}
