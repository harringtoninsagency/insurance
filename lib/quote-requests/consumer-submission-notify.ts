import { loadEmailConfig } from "@/lib/email/config";
import { resendProvider } from "@/lib/email/provider";
import { escapeHtml } from "@/lib/email/escape-html";

const NOTIFY_TO = "harringtonagency@brightway.com";

/**
 * Internal heads-up the moment a homeowner submits the public re-shop page
 * (app/quote) — fired right after the request is saved, before enrichment
 * or quoting even runs, so the agency sees every raw submission immediately
 * rather than waiting on notifyNeedsReview (which only fires if matching
 * fails) or the completion email (which only fires once a full quote
 * exists, possibly minutes later). Runs from a Vercel server action, so —
 * like notifyNeedsReview — it's safe to call Resend directly. Never throws:
 * a failed notification must not fail the submission that triggered it.
 */
export async function notifyConsumerQuoteSubmission(input: {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  formattedAddress: string;
  addressLine: string;
  city: string;
  state: string;
  zipcode: string;
  /** Which marketed funnel this came through (e.g. "instahomequote") — changes only the subject line, so it's identifiable/filterable in the inbox. */
  leadSource?: string | null;
}): Promise<void> {
  const cfg = loadEmailConfig();
  if (!cfg.ok) {
    console.error(`Skipped consumer-submission notification: missing ${cfg.missing.join(", ")}`);
    return;
  }

  const address = input.formattedAddress || [input.addressLine, input.city, `${input.state} ${input.zipcode}`.trim()].filter(Boolean).join(", ");
  const dashboardUrl = `${cfg.config.baseUrl}/quote-requests`;
  const subject = input.leadSource === "instahomequote" ? "InstaHomeQuote - New Quote Request" : `New quote request — ${address}`;

  const rows: Array<[string, string]> = [
    ["Name", `${input.firstName} ${input.lastName}`.trim()],
    ["Email", input.email],
    ["Phone", input.phone],
    ["Address", address],
  ];

  try {
    await resendProvider(cfg.config.apiKey).send({
      from: cfg.config.from,
      to: NOTIFY_TO,
      replyTo: cfg.config.replyTo,
      subject,
      text: [
        "A visitor submitted the public quote page with the following details:",
        "",
        ...rows.map(([label, value]) => `${label}: ${value}`),
        "",
        `View it in the dashboard: ${dashboardUrl}`,
      ].join("\n"),
      html: [
        `<p>A visitor submitted the public quote page with the following details:</p>`,
        `<table cellpadding="4" cellspacing="0">`,
        rows.map(([label, value]) => `<tr><td><strong>${escapeHtml(label)}</strong></td><td>${escapeHtml(value)}</td></tr>`).join(""),
        `</table>`,
        `<p>View it in the <a href="${escapeHtml(dashboardUrl)}">dashboard</a>.</p>`,
      ].join(""),
    });
  } catch (err) {
    console.error(`Failed to send consumer-submission notification: ${err instanceof Error ? err.message : String(err)}`);
  }
}
