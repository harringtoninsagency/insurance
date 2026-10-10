import { createServiceSupabase } from "@/lib/supabase/server";
import { loadEmailConfig } from "@/lib/email/config";
import { escapeHtml } from "@/lib/email/escape-html";

// Every outbound email to a referral partner gets the agency CC'd, by
// explicit instruction — separate from OUTREACH_FROM (the agency's own
// sending address), which is already on every email as the sender.
const PARTNER_CC = "harringtonagency@brightway.com";

// How long the signed PDF URLs stay valid for the agent to hand to the send
// tool — generous, since finalizeQuoteRequest's caller sends immediately
// after, but this isn't time-critical either.
const ATTACHMENT_URL_TTL_SECONDS = 3600;

export interface QuoteCompletionEmail {
  to: string;
  cc: string;
  replyTo: string | null;
  subject: string;
  text: string;
  html: string;
  attachments: Array<{ filename: string; url: string }>;
  idempotencyKey: string;
}

/**
 * Builds (but does not send) the referral partner's copy of their completed
 * quote request — only for partner-submitted requests (public/internal
 * requests still go through the producer-reviewed outreach queue on
 * /review, unaffected by this). Called from finalizeQuoteRequest, which
 * never throws on a null/missing result here so a build problem can't turn
 * an otherwise-completed quote request into a failure.
 *
 * Deliberately returns data instead of sending it directly: unlike
 * notifyNewPartnerAccount and sendApprovedOutreach (both called from Vercel
 * server actions, where a plain Resend HTTP call works fine),
 * finalizeQuoteRequest only ever runs inside a Claude Code agent session
 * (see docs/process-quote-requests.md — Fetch's carrier-quoting tools are
 * only reachable that way). That session's own egress proxy blocks raw
 * outbound calls to api.resend.com even with a valid key, confirmed live.
 * The already-connected Resend MCP tool isn't subject to that block, but
 * it's only callable by the agent itself, not from library code — so the
 * agent sends this payload via that tool, the same pattern already used
 * here for Fetch's own MCP-only tools.
 */
export async function buildQuoteCompletionEmail(quoteRequestId: string, proposalIds: string[]): Promise<QuoteCompletionEmail | null> {
  if (!proposalIds.length) return null;

  try {
    const supabase = createServiceSupabase();
    const { data: request } = await supabase
      .from("quote_requests")
      .select("requester_type, requester_email, requester_name, property_id")
      .eq("id", quoteRequestId)
      .single();
    if (!request || request.requester_type !== "partner" || !request.requester_email || !request.property_id) return null;

    const cfg = loadEmailConfig();
    if (!cfg.ok) {
      console.error(`Skipped quote-completion email for ${quoteRequestId}: missing ${cfg.missing.join(", ")}`);
      return null;
    }

    const [{ data: property }, { data: proposals }] = await Promise.all([
      supabase.from("properties").select("address").eq("id", request.property_id).single(),
      supabase.from("proposals").select("id, kind, pdf_path").in("id", proposalIds),
    ]);
    if (!property) return null;

    const withPdf = (proposals ?? []).filter((p): p is typeof p & { pdf_path: string } => !!p.pdf_path);
    if (!withPdf.length) return null;

    const addressSlug = property.address.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");
    const signed = await Promise.all(
      withPdf.map(async (p) => {
        const { data } = await supabase.storage.from("proposals").createSignedUrl(p.pdf_path, ATTACHMENT_URL_TTL_SECONDS);
        if (!data) return null;
        return { filename: `${p.kind}-${addressSlug}.pdf`, url: data.signedUrl };
      })
    );
    const attachments = signed.filter((f): f is NonNullable<typeof f> => !!f);
    if (!attachments.length) return null;

    const name = request.requester_name ?? "there";
    return {
      to: request.requester_email,
      cc: PARTNER_CC,
      replyTo: cfg.config.replyTo,
      subject: `Your quote request is ready — ${property.address}`,
      text: `Hi ${name},\n\nYour request for ${property.address} is complete. The insurance summary / listing snapshot is attached.\n\n— Brightway Insurance | The Harrington Agency`,
      html: `<p>Hi ${escapeHtml(name)},</p><p>Your request for <strong>${escapeHtml(property.address)}</strong> is complete. The insurance summary / listing snapshot is attached.</p><p>— Brightway Insurance | The Harrington Agency</p>`,
      attachments,
      idempotencyKey: `quote-completion-${quoteRequestId}`,
    };
  } catch (err) {
    console.error(`Failed to build quote-completion email for ${quoteRequestId}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
