import { createServiceSupabase } from "@/lib/supabase/server";
import { checkRecipient } from "@/lib/outreach/check-recipient";
import { buildOutreachMessage } from "@/lib/outreach/message";
import { createUnsubscribeToken } from "@/lib/email/unsubscribe-token";
import type { EmailConfig } from "@/lib/email/config";
import type { EmailProvider } from "@/lib/email/provider";

export type SendResult =
  | { status: "sent"; messageId: string }
  | { status: "skipped"; reason: string }
  | { status: "blocked"; reason: string }
  | { status: "failed"; error: string };

/**
 * Sends one approved outreach item. Layers of protection, in order:
 *   1. Only items a producer approved are ever sent.
 *   2. The item is *claimed* (sent_at set) with a conditional update before the
 *      provider is called, so a double-click or a second worker can't send it
 *      twice; a failed send releases the claim so it can be retried.
 *   3. The recipient is re-checked against suppressions and the directory at
 *      the moment of sending — an opt-out since approval stops the send.
 * If the process dies after the provider accepts the message but before the
 * result is saved, the claim stays set: the item is *not* re-sent (the safe
 * failure), and the provider's idempotency key covers a retry within 24h.
 */
export async function sendApprovedOutreach(
  outreachId: string,
  provider: EmailProvider,
  config: EmailConfig
): Promise<SendResult> {
  const supabase = createServiceSupabase();

  const { data: claimed, error: claimError } = await supabase
    .from("outreach")
    .update({ sent_at: new Date().toISOString(), send_error: null })
    .eq("id", outreachId)
    .eq("status", "approved")
    .is("sent_at", null)
    .select("id, agency_id, recipient, contact_id, proposal_id")
    .maybeSingle();
  if (claimError) return { status: "failed", error: claimError.message };
  if (!claimed) return { status: "skipped", reason: "Not approved, or already sent." };

  const release = (error: string) =>
    supabase.from("outreach").update({ sent_at: null, send_error: error }).eq("id", outreachId);

  try {
    const check = await checkRecipient(supabase, claimed.agency_id, claimed.recipient);
    if (!check.allowed) {
      await supabase.from("outreach").update({ status: "rejected", sent_at: null, send_error: check.reason }).eq("id", outreachId);
      return { status: "blocked", reason: check.reason };
    }

    const { data: proposal } = await supabase.from("proposals").select("pdf_path, property_id").eq("id", claimed.proposal_id).single();
    if (!proposal?.pdf_path) {
      await release("The proposal has no PDF to attach.");
      return { status: "failed", error: "The proposal has no PDF to attach." };
    }
    const [{ data: property }, { data: file, error: downloadError }] = await Promise.all([
      supabase.from("properties").select("address").eq("id", proposal.property_id).single(),
      supabase.storage.from("proposals").download(proposal.pdf_path),
    ]);
    if (downloadError || !file || !property) {
      const message = `Couldn't load the proposal PDF: ${downloadError?.message ?? "missing property"}`;
      await release(message);
      return { status: "failed", error: message };
    }

    const token = encodeURIComponent(createUnsubscribeToken(outreachId, config.unsubscribeSecret));
    const message = buildOutreachMessage({
      recipientName: check.contact?.full_name ?? null,
      propertyAddress: property.address,
      unsubscribeUrl: `${config.baseUrl}/unsubscribe?t=${token}`,
      config,
    });
    const fileSlug = property.address.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");

    const { id: messageId } = await provider.send({
      from: config.from,
      to: claimed.recipient,
      replyTo: config.replyTo,
      subject: message.subject,
      html: message.html,
      text: message.text,
      // One-click unsubscribe (RFC 8058): mail clients show their own
      // "Unsubscribe" button, which POSTs to the API route.
      headers: {
        "List-Unsubscribe": `<${config.baseUrl}/api/unsubscribe?t=${token}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
      attachments: [{ filename: `insurance-snapshot-${fileSlug}.pdf`, content: Buffer.from(await file.arrayBuffer()) }],
      idempotencyKey: `outreach-${outreachId}`,
    });

    await supabase.from("outreach").update({ status: "sent", provider_message_id: messageId, send_error: null }).eq("id", outreachId);
    if (check.contact && check.contact.status === "prospect") {
      await supabase.from("industry_contacts").update({ status: "contacted", updated_at: new Date().toISOString() }).eq("id", check.contact.id);
    }
    return { status: "sent", messageId };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Send failed";
    await release(message);
    return { status: "failed", error: message };
  }
}
