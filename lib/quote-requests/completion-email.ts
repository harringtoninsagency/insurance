import { createServiceSupabase } from "@/lib/supabase/server";
import { loadEmailConfig } from "@/lib/email/config";
import { escapeHtml } from "@/lib/email/escape-html";
import { brandedEmailShell, brandedSignatureHtml } from "@/lib/email/brand-template";
import { CONTACT_EMAIL, CONTACT_PHONE } from "@/lib/contacts/consent-text";
import { resolveProposalAgent } from "@/lib/quote-requests/proposal-agent";

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
  cc: string[];
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
 * notifyNewAccessRequest and sendApprovedOutreach (both called from Vercel
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
      .select("requester_type, requester_email, requester_name, property_id, contact_id")
      .eq("id", quoteRequestId)
      .single();
    if (!request || request.requester_type !== "partner" || !request.contact_id || !request.property_id) return null;

    // The account's actual email of record — the same address the partner
    // was invited with (lib/partners/invite.ts), whether invited directly or
    // via an approved access request (app/(dash)/contacts/access-requests/actions.ts)
    // — rather than whatever the partner typed into the form's editable
    // "Send results to" field, so results always reach the designated account
    // regardless of what that field says.
    const { data: contact } = await supabase.from("industry_contacts").select("email").eq("id", request.contact_id).single();
    if (!contact?.email) return null;

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
    const summaryLabel = withPdf.some((p) => p.kind === "roof_scenario") ? "New Roof Scenario - Insurance Summary" : "insurance summary";

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
    // Depending on which Brightway agent the partner picked (or was
    // defaulted to — resolveProposalAgent's own precedence), CC that agent
    // too, so they see every result for a property credited to them, same
    // way the agency itself always gets a copy (PARTNER_CC). If the partner
    // asked for results at a different inbox than their account's email of
    // record, honor that too — both as added recipients, never a
    // replacement for the guaranteed one above.
    const agent = await resolveProposalAgent(request.property_id, quoteRequestId);
    const seen = new Set([contact.email.toLowerCase()]);
    const cc = [PARTNER_CC];
    seen.add(PARTNER_CC.toLowerCase());
    for (const candidate of [agent?.email, request.requester_email]) {
      if (candidate && !seen.has(candidate.toLowerCase())) {
        cc.push(candidate);
        seen.add(candidate.toLowerCase());
      }
    }
    const text = [
      `Hi ${name},`,
      "",
      "Thank you for reaching out to Brightway Insurance | The Harrington Agency!",
      "",
      `Your request for ${property.address} is complete. The ${summaryLabel} and listing snapshot are attached.`,
      "",
      "Brightway Insurance | The Harrington Agency",
      `${CONTACT_EMAIL} | ${CONTACT_PHONE}`,
    ].join("\n");

    const html = brandedEmailShell(
      [
        `<p style="margin:0 0 16px;">Hi ${escapeHtml(name)},</p>`,
        `<p style="margin:0 0 16px;">Thank you for reaching out to Brightway Insurance | The Harrington Agency!</p>`,
        `<p style="margin:0 0 24px;">Your request for <strong>${escapeHtml(property.address)}</strong> is complete. The ${escapeHtml(summaryLabel)} and listing snapshot are attached.</p>`,
        brandedSignatureHtml(escapeHtml(CONTACT_EMAIL), escapeHtml(CONTACT_PHONE)),
      ].join("")
    );

    return {
      to: contact.email,
      cc,
      replyTo: cfg.config.replyTo,
      subject: `Your quote request is ready — ${property.address}`,
      text,
      html,
      attachments,
      idempotencyKey: `quote-completion-${quoteRequestId}`,
    };
  } catch (err) {
    console.error(`Failed to build quote-completion email for ${quoteRequestId}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
