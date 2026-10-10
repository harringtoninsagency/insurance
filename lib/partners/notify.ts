import { loadEmailConfig } from "@/lib/email/config";
import { resendProvider } from "@/lib/email/provider";
import { escapeHtml } from "@/lib/email/escape-html";
import type { ContactType } from "@/lib/types/database";

const NOTIFY_TO = "tim.harrington@brightway.com";

/**
 * Internal heads-up to the agency when a realtor/mortgage broker self-signs-up
 * for a partner account (lib/partners/self-signup.ts already upserts them
 * into industry_contacts — this is just the notification). Never throws:
 * a failed notification email must not fail the signup itself.
 */
export async function notifyNewPartnerAccount(input: { fullName: string; email: string; phoneDigits: string; contactType: ContactType }): Promise<void> {
  const cfg = loadEmailConfig();
  if (!cfg.ok) {
    console.error(`Skipped new-partner-account email: missing ${cfg.missing.join(", ")}`);
    return;
  }

  const typeLabel = input.contactType === "realtor" ? "Realtor" : "Mortgage broker";
  const phone = `${input.phoneDigits.slice(0, 3)}-${input.phoneDigits.slice(3, 6)}-${input.phoneDigits.slice(6)}`;

  try {
    await resendProvider(cfg.config.apiKey).send({
      from: cfg.config.from,
      to: NOTIFY_TO,
      replyTo: cfg.config.replyTo,
      subject: "New Referral Partner account",
      text: `${input.fullName} (${typeLabel}) just created a referral partner account.\n\nEmail: ${input.email}\nPhone: ${phone}`,
      html: `<p><strong>${escapeHtml(input.fullName)}</strong> (${typeLabel}) just created a referral partner account.</p><p>Email: ${escapeHtml(input.email)}<br>Phone: ${phone}</p>`,
    });
  } catch (err) {
    console.error(`Failed to send new-partner-account email: ${err instanceof Error ? err.message : String(err)}`);
  }
}
