import { createServiceSupabase } from "@/lib/supabase/server";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class SuppressedRecipientError extends Error {}

/**
 * Queues an outreach item for producer review. Checks the agency's
 * suppression list (exact email or domain match) before queuing — a
 * suppressed recipient is refused, not silently dropped, so the producer
 * knows why nothing was queued.
 */
export async function queueOutreach(
  agencyId: string,
  proposalId: string,
  recipient: string
): Promise<{ id: string }> {
  const trimmed = recipient.trim().toLowerCase();
  if (!EMAIL_RE.test(trimmed)) {
    throw new Error(`"${recipient}" doesn't look like a valid email address`);
  }
  const domain = trimmed.split("@")[1]!;

  const supabase = createServiceSupabase();

  const { data: suppressions, error: suppressionError } = await supabase
    .from("suppressions")
    .select("email_or_domain, reason")
    .eq("agency_id", agencyId)
    .in("email_or_domain", [trimmed, domain]);
  if (suppressionError) {
    throw new Error(`Suppression check failed: ${suppressionError.message}`);
  }
  if (suppressions?.length) {
    const hit = suppressions[0]!;
    throw new SuppressedRecipientError(
      `${trimmed} is suppressed (matched "${hit.email_or_domain}"${hit.reason ? `: ${hit.reason}` : ""})`
    );
  }

  const { data, error } = await supabase
    .from("outreach")
    .insert({ agency_id: agencyId, proposal_id: proposalId, recipient: trimmed, status: "pending_review" })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`Failed to queue outreach: ${error?.message ?? "no row returned"}`);
  }

  return { id: data.id };
}
