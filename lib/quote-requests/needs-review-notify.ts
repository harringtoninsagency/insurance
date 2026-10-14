import { loadEmailConfig } from "@/lib/email/config";
import { resendProvider } from "@/lib/email/provider";
import { escapeHtml } from "@/lib/email/escape-html";

const NOTIFY_TO = "harringtonagency@brightway.com";

/**
 * Internal heads-up the moment a public or partner quote request lands in
 * needs_review (no matching county record, or a match missing year
 * built/sqft) — otherwise it just sits in the queue until a producer
 * happens to notice it there. Skipped for requester_type "internal": a team
 * member queuing their own request already sees needs_review on the screen
 * immediately, so an email would be redundant. Runs from a Vercel server
 * action (prepareQuoteRequest happens synchronously on submit, no Fetch/
 * agent session needed), so — like notifyReferralPartnerSubmission — it's
 * safe to call Resend directly. Never throws: a failed notification must
 * not fail the submission that triggered it.
 */
export async function notifyNeedsReview(input: {
  requesterType: string;
  requesterName: string;
  requesterEmail: string;
  addressLine: string;
  city: string;
  state: string;
  detail: string;
}): Promise<void> {
  if (input.requesterType === "internal") return;

  const cfg = loadEmailConfig();
  if (!cfg.ok) {
    console.error(`Skipped needs-review notification: missing ${cfg.missing.join(", ")}`);
    return;
  }

  const address = `${input.addressLine}, ${input.city}, ${input.state}`;
  const requesterKind = input.requesterType === "partner" ? "A referral partner" : "A visitor";
  const dashboardUrl = `${cfg.config.baseUrl}/quote-requests`;

  try {
    await resendProvider(cfg.config.apiKey).send({
      from: cfg.config.from,
      to: NOTIFY_TO,
      replyTo: cfg.config.replyTo,
      subject: `Quote request needs review — ${address}`,
      text: [
        `${requesterKind} (${input.requesterName}, ${input.requesterEmail}) requested a quote for ${address}, but it couldn't be matched automatically:`,
        "",
        input.detail,
        "",
        `Fill in the missing details (or fix the address) in the dashboard so it can be quoted: ${dashboardUrl}`,
      ].join("\n"),
      html: [
        `<p>${escapeHtml(requesterKind)} (${escapeHtml(input.requesterName)}, ${escapeHtml(input.requesterEmail)}) requested a quote for <strong>${escapeHtml(address)}</strong>, but it couldn't be matched automatically:</p>`,
        `<p>${escapeHtml(input.detail)}</p>`,
        `<p>Fill in the missing details (or fix the address) in the <a href="${escapeHtml(dashboardUrl)}">dashboard</a> so it can be quoted.</p>`,
      ].join(""),
    });
  } catch (err) {
    console.error(`Failed to send needs-review notification: ${err instanceof Error ? err.message : String(err)}`);
  }
}
