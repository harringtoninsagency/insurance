import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { escapeLike } from "@/lib/contacts/upsert-contact";

type ContactRow = Database["public"]["Tables"]["industry_contacts"]["Row"];

export type RecipientCheck =
  | { allowed: false; reason: string }
  // `contact` is the directory entry for this email, or null for someone outside the directory.
  | { allowed: true; contact: ContactRow | null };

/**
 * The single gate every outreach email goes through, both when it's queued and
 * again when it's approved (a contact can opt out in between). Refuses:
 *   - anyone on the agency's suppression list (exact email or whole domain)
 *   - a directory contact marked do-not-contact
 *   - a directory contact who opted out of email
 * Contacts with no opt-in on record ("unknown") are allowed — a first,
 * relevant business email with an unsubscribe is permitted — but the review
 * screen labels them so a producer decides knowingly.
 */
export async function checkRecipient(
  supabase: SupabaseClient<Database>,
  agencyId: string,
  email: string
): Promise<RecipientCheck> {
  const address = email.trim().toLowerCase();
  const domain = address.split("@")[1] ?? "";

  const { data: suppressions, error: suppressionError } = await supabase
    .from("suppressions")
    .select("email_or_domain, reason")
    .eq("agency_id", agencyId)
    .in("email_or_domain", [address, domain]);
  if (suppressionError) throw new Error(`Suppression check failed: ${suppressionError.message}`);
  if (suppressions?.length) {
    const hit = suppressions[0]!;
    return {
      allowed: false,
      reason: `${address} is suppressed (matched "${hit.email_or_domain}"${hit.reason ? `: ${hit.reason}` : ""})`,
    };
  }

  const { data: contacts, error: contactError } = await supabase
    .from("industry_contacts")
    .select("*")
    .eq("agency_id", agencyId)
    .ilike("email", escapeLike(address))
    .limit(1);
  if (contactError) throw new Error(`Directory check failed: ${contactError.message}`);

  const contact = contacts?.[0] ?? null;
  if (contact?.do_not_contact) {
    return { allowed: false, reason: `${contact.full_name} is marked do-not-contact in the directory` };
  }
  if (contact?.email_consent === "opted_out") {
    return { allowed: false, reason: `${contact.full_name} has opted out of email` };
  }
  return { allowed: true, contact };
}
