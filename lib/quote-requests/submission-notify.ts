import { loadEmailConfig } from "@/lib/email/config";
import { resendProvider } from "@/lib/email/provider";
import { escapeHtml } from "@/lib/email/escape-html";

const NOTIFY_TO = "harringtonagency@brightway.com";

/**
 * Internal heads-up the moment a referral partner submits a quote request
 * through the partner portal — separate from (and sent well before)
 * buildQuoteCompletionEmail's results email, which only goes out once the
 * quote actually finishes. Runs from a Vercel server action (submission
 * happens synchronously in submitPartnerQuoteRequestAction), so — unlike
 * completion-email.ts — it's safe to call Resend directly here. Never
 * throws: a failed notification must not fail the partner's submission.
 */
export async function notifyReferralPartnerSubmission(input: {
  partnerName: string;
  partnerEmail: string;
  addressLine: string;
  city: string;
  state: string;
  requestKind: string;
}): Promise<void> {
  const cfg = loadEmailConfig();
  if (!cfg.ok) {
    console.error(`Skipped referral-partner-submission email: missing ${cfg.missing.join(", ")}`);
    return;
  }

  const address = `${input.addressLine}, ${input.city}, ${input.state}`;
  const kindLabel = input.requestKind === "both" ? "Quote summary + listing snapshot" : input.requestKind === "listing_snapshot" ? "Listing snapshot" : "Multi-carrier quote summary";

  try {
    await resendProvider(cfg.config.apiKey).send({
      from: cfg.config.from,
      to: NOTIFY_TO,
      replyTo: cfg.config.replyTo,
      subject: "Referral Partner Insurance Request",
      text: `${input.partnerName} (${input.partnerEmail}) just submitted a quote request.\n\nProperty: ${address}\nRequested: ${kindLabel}`,
      html: `<p><strong>${escapeHtml(input.partnerName)}</strong> (${escapeHtml(input.partnerEmail)}) just submitted a quote request.</p><p>Property: ${escapeHtml(address)}<br>Requested: ${escapeHtml(kindLabel)}</p>`,
    });
  } catch (err) {
    console.error(`Failed to send referral-partner-submission email: ${err instanceof Error ? err.message : String(err)}`);
  }
}
