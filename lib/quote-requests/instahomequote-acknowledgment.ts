import { loadEmailConfig } from "@/lib/email/config";
import { resendProvider } from "@/lib/email/provider";
import { escapeHtml } from "@/lib/email/escape-html";
import { brandedEmailShell, DEEP_BLUE, SLATE_MUTED } from "@/lib/email/brand-template";

// Given verbatim for this reply's signature, with the extension — distinct
// from CONTACT_PHONE (lib/contacts/consent-text.ts), which every other email
// uses without one; this one email is the only place that extension belongs.
const AGENCY_PHONE_WITH_EXTENSION = "727-789-2200 X.1";

/**
 * Immediate "thanks for your request" reply to the customer, sent the
 * moment an InstaHomeQuote submission is saved — before carrier quoting
 * even runs (that takes ~2 minutes and arrives separately as its own email
 * with the actual quote attached; see lib/quote-requests/completion-email.ts
 * and its pendingAgencyCopyEmail). Runs from a Vercel server action
 * (app/quote/actions.ts), so — like notifyConsumerQuoteSubmission — it's
 * safe to call Resend directly. Never throws: a failed send must not fail
 * the submission that triggered it.
 */
export async function sendInstaHomeQuoteAcknowledgment(input: { firstName: string; email: string }): Promise<void> {
  const cfg = loadEmailConfig();
  if (!cfg.ok) {
    console.error(`Skipped InstaHomeQuote acknowledgment: missing ${cfg.missing.join(", ")}`);
    return;
  }

  const firstName = input.firstName.trim() || "there";
  const text = [
    `Thank you ${firstName} for your interest in requesting competitive home insurance solutions.`,
    "",
    "InstaHomeQuote powered by Brightway Insurance | The Harrington Agency is happy to assist going forward. One of our agents will be happy to help in any way possible!",
    "",
    "Brightway Insurance | The Harrington Agency",
    AGENCY_PHONE_WITH_EXTENSION,
  ].join("\n");

  const html = brandedEmailShell(
    [
      `<p style="margin:0 0 16px;">Thank you ${escapeHtml(firstName)} for your interest in requesting competitive home insurance solutions.</p>`,
      `<p style="margin:0 0 24px;">InstaHomeQuote powered by Brightway Insurance | The Harrington Agency is happy to assist going forward. One of our agents will be happy to help in any way possible!</p>`,
      `<p style="margin:0 0 4px;font-weight:bold;color:${DEEP_BLUE};">Brightway Insurance | The Harrington Agency</p>`,
      `<p style="margin:0;color:${SLATE_MUTED};">${escapeHtml(AGENCY_PHONE_WITH_EXTENSION)}</p>`,
    ].join("")
  );

  try {
    await resendProvider(cfg.config.apiKey).send({
      from: cfg.config.from,
      to: input.email,
      replyTo: cfg.config.replyTo,
      subject: "Thank You for Your InstaHomeQuote Request",
      text,
      html,
    });
  } catch (err) {
    console.error(`Failed to send InstaHomeQuote acknowledgment to ${input.email}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
