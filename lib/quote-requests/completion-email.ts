import { createServiceSupabase } from "@/lib/supabase/server";
import { loadEmailConfig } from "@/lib/email/config";
import { resendProvider } from "@/lib/email/provider";
import { escapeHtml } from "@/lib/email/escape-html";

// Every outbound email to a referral partner gets the agency CC'd, by
// explicit instruction — separate from OUTREACH_FROM (the agency's own
// sending address), which is already on every email as the sender.
const PARTNER_CC = "harringtonagency@brightway.com";

/**
 * Automatically emails the referral partner a copy of the proposal(s) once
 * their own quote request completes — only for partner-submitted requests
 * (public/internal requests still go through the producer-reviewed outreach
 * queue on /review, unaffected by this). Called from finalizeQuoteRequest;
 * never throws, so a failed email can't turn an otherwise-completed quote
 * request into a failure.
 */
export async function sendQuoteCompletionEmail(quoteRequestId: string, proposalIds: string[]): Promise<void> {
  if (!proposalIds.length) return;

  try {
    const supabase = createServiceSupabase();
    const { data: request } = await supabase
      .from("quote_requests")
      .select("requester_type, requester_email, requester_name, property_id")
      .eq("id", quoteRequestId)
      .single();
    if (!request || request.requester_type !== "partner" || !request.requester_email || !request.property_id) return;

    const cfg = loadEmailConfig();
    if (!cfg.ok) {
      console.error(`Skipped quote-completion email for ${quoteRequestId}: missing ${cfg.missing.join(", ")}`);
      return;
    }

    const [{ data: property }, { data: proposals }] = await Promise.all([
      supabase.from("properties").select("address").eq("id", request.property_id).single(),
      supabase.from("proposals").select("id, kind, pdf_path").in("id", proposalIds),
    ]);
    if (!property) return;

    const withPdf = (proposals ?? []).filter((p): p is typeof p & { pdf_path: string } => !!p.pdf_path);
    if (!withPdf.length) return;

    const addressSlug = property.address.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");
    const downloaded = await Promise.all(
      withPdf.map(async (p) => {
        const { data: file } = await supabase.storage.from("proposals").download(p.pdf_path);
        if (!file) return null;
        return { filename: `${p.kind}-${addressSlug}.pdf`, content: Buffer.from(await file.arrayBuffer()) };
      })
    );
    const attachments = downloaded.filter((f): f is NonNullable<typeof f> => !!f);
    if (!attachments.length) return;

    const name = request.requester_name ?? "there";
    await resendProvider(cfg.config.apiKey).send({
      from: cfg.config.from,
      to: request.requester_email,
      cc: PARTNER_CC,
      replyTo: cfg.config.replyTo,
      subject: `Your quote request is ready — ${property.address}`,
      text: `Hi ${name},\n\nYour request for ${property.address} is complete. The insurance summary / listing snapshot is attached.\n\n— Brightway Insurance | The Harrington Agency`,
      html: `<p>Hi ${escapeHtml(name)},</p><p>Your request for <strong>${escapeHtml(property.address)}</strong> is complete. The insurance summary / listing snapshot is attached.</p><p>— Brightway Insurance | The Harrington Agency</p>`,
      attachments,
      idempotencyKey: `quote-completion-${quoteRequestId}`,
    });
  } catch (err) {
    console.error(`Failed to send quote-completion email for ${quoteRequestId}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
