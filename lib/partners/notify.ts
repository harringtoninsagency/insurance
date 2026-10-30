import { loadEmailConfig } from "@/lib/email/config";
import { resendProvider } from "@/lib/email/provider";
import { escapeHtml } from "@/lib/email/escape-html";
import type { ContactType } from "@/lib/types/database";

const NOTIFY_TO = "tim.harrington@brightway.com";

/**
 * Internal heads-up when a realtor, mortgage broker, or roofing company
 * submits a partner access request (lib/partners/request-access.ts already
 * saved it to partner_access_requests — this is just the notification).
 * Review and approve/deny from /contacts/access-requests. Never throws: a
 * failed notification email must not fail the request submission itself.
 */
export async function notifyNewAccessRequest(input: { fullName: string; email: string; phoneDigits: string; contactType: ContactType; licenseNumber: string }): Promise<void> {
  const cfg = loadEmailConfig();
  if (!cfg.ok) {
    console.error(`Skipped new-access-request email: missing ${cfg.missing.join(", ")}`);
    return;
  }

  const typeLabel = input.contactType === "realtor" ? "Realtor" : input.contactType === "roofing_company" ? "Roofing company" : "Mortgage broker";
  const phone = `${input.phoneDigits.slice(0, 3)}-${input.phoneDigits.slice(3, 6)}-${input.phoneDigits.slice(6)}`;

  try {
    await resendProvider(cfg.config.apiKey).send({
      from: cfg.config.from,
      to: NOTIFY_TO,
      replyTo: cfg.config.replyTo,
      subject: "New partner access request",
      text: `${input.fullName} (${typeLabel}) requested partner app access.\n\nLicense: ${input.licenseNumber}\nEmail: ${input.email}\nPhone: ${phone}\n\nReview at /contacts/access-requests`,
      html: `<p><strong>${escapeHtml(input.fullName)}</strong> (${typeLabel}) requested partner app access.</p><p>License: ${escapeHtml(input.licenseNumber)}<br>Email: ${escapeHtml(input.email)}<br>Phone: ${phone}</p><p>Review at /contacts/access-requests</p>`,
    });
  } catch (err) {
    console.error(`Failed to send new-access-request email: ${err instanceof Error ? err.message : String(err)}`);
  }
}
