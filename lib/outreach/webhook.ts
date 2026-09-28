import { createHmac, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { applyConsentEvent } from "@/lib/contacts/consent";
import { escapeLike } from "@/lib/contacts/upsert-contact";

const TOLERANCE_MS = 5 * 60 * 1000;

/**
 * Verifies a Svix-signed webhook (Resend signs its webhooks this way): the
 * signature is HMAC-SHA256 over "<id>.<timestamp>.<raw body>", keyed with the
 * base64 part of the "whsec_..." secret, and the header may list several
 * space-separated "v1,<sig>" values. Must be given the *raw* request body.
 */
export function verifySvixSignature(
  rawBody: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  secret: string,
  now: number = Date.now()
): boolean {
  if (!headers.id || !headers.timestamp || !headers.signature) return false;
  const sentAt = Number(headers.timestamp) * 1000;
  if (!Number.isFinite(sentAt) || Math.abs(now - sentAt) > TOLERANCE_MS) return false;

  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${headers.id}.${headers.timestamp}.${rawBody}`).digest();

  return headers.signature.split(" ").some((part) => {
    const [version, sig] = part.split(",");
    if (version !== "v1" || !sig) return false;
    const given = Buffer.from(sig, "base64");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

interface ResendEvent {
  type?: string;
  data?: { email_id?: string; to?: string[] | string };
}

async function suppress(supabase: SupabaseClient<Database>, agencyId: string, email: string, reason: string) {
  const { error } = await supabase
    .from("suppressions")
    .upsert({ agency_id: agencyId, email_or_domain: email, reason }, { onConflict: "agency_id,email_or_domain", ignoreDuplicates: true });
  if (error) throw new Error(`Couldn't suppress ${email}: ${error.message}`);
}

/**
 * Acts on the two delivery events that matter for list hygiene; everything else
 * (delivered, opened, ...) is acknowledged and ignored.
 *   email.bounced    — the address is dead: mark the item bounced and suppress it.
 *   email.complained — the recipient marked it as spam: suppress and mark the
 *                      directory contact do-not-contact.
 * Throws on a database failure so the webhook returns an error and the
 * provider retries; safe to run twice for the same event.
 */
export async function handleResendEvent(supabase: SupabaseClient<Database>, event: ResendEvent): Promise<string> {
  if (event.type !== "email.bounced" && event.type !== "email.complained") return "ignored";
  const messageId = event.data?.email_id;
  if (!messageId) return "ignored: no email_id";

  const { data: item } = await supabase
    .from("outreach")
    .select("id, agency_id, recipient, contact_id")
    .eq("provider_message_id", messageId)
    .maybeSingle();
  if (!item) return "ignored: unknown message";

  if (event.type === "email.bounced") {
    await supabase.from("outreach").update({ status: "bounced", send_error: "Bounced: the address rejected the email" }).eq("id", item.id);
    await suppress(supabase, item.agency_id, item.recipient, "Hard bounce");
    return "bounced";
  }

  await supabase.from("outreach").update({ send_error: "Recipient marked the email as spam" }).eq("id", item.id);
  await suppress(supabase, item.agency_id, item.recipient, "Spam complaint");

  const contactQuery = supabase.from("industry_contacts").select("*").eq("agency_id", item.agency_id);
  const { data: contacts } = item.contact_id
    ? await contactQuery.eq("id", item.contact_id).limit(1)
    : await contactQuery.ilike("email", escapeLike(item.recipient)).limit(1);
  const contact = contacts?.[0];
  if (contact && !contact.do_not_contact) {
    await applyConsentEvent(supabase, contact, {
      type: "do_not_contact",
      method: "directory",
      note: "Marked an outreach email as spam (complaint reported by the email provider)",
      recordedBy: "email provider",
    });
  }
  return "complained";
}
