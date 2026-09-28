import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { verifyUnsubscribeToken } from "@/lib/email/unsubscribe-token";
import { applyConsentEvent } from "@/lib/contacts/consent";
import { escapeLike } from "@/lib/contacts/upsert-contact";

export type UnsubscribeResult = { ok: true; email: string } | { ok: false; error: string };

/**
 * Honors an unsubscribe click. The address goes on the agency's suppression
 * list (so it holds even if the directory entry is later deleted) and, if the
 * person is in the directory, an email opt-out is logged in their consent
 * history. Safe to run twice for the same link.
 */
export async function processUnsubscribe(
  supabase: SupabaseClient<Database>,
  secret: string,
  token: string
): Promise<UnsubscribeResult> {
  const outreachId = verifyUnsubscribeToken(token, secret);
  if (!outreachId) return { ok: false, error: "This unsubscribe link isn't valid." };

  const { data: item } = await supabase.from("outreach").select("agency_id, recipient, contact_id").eq("id", outreachId).single();
  if (!item) return { ok: false, error: "This unsubscribe link isn't valid." };

  const { error: suppressError } = await supabase
    .from("suppressions")
    .upsert(
      { agency_id: item.agency_id, email_or_domain: item.recipient, reason: "Unsubscribed via email link" },
      { onConflict: "agency_id,email_or_domain", ignoreDuplicates: true }
    );
  if (suppressError) return { ok: false, error: "Something went wrong. Please try again or email us." };

  const contactQuery = supabase.from("industry_contacts").select("*").eq("agency_id", item.agency_id);
  const { data: contacts } = item.contact_id
    ? await contactQuery.eq("id", item.contact_id).limit(1)
    : await contactQuery.ilike("email", escapeLike(item.recipient)).limit(1);
  const contact = contacts?.[0];
  if (contact && contact.email_consent !== "opted_out") {
    await applyConsentEvent(supabase, contact, {
      type: "email_opt_out",
      method: "web_form",
      note: "Unsubscribed using the link in an outreach email",
      recordedBy: "unsubscribe link",
    });
  }
  return { ok: true, email: item.recipient };
}
