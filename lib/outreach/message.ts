import type { EmailConfig } from "@/lib/email/config";

const CONTACT_EMAIL = "harringtonagency@brightway.com";
const CONTACT_PHONE = "727-789-2200";

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export interface OutreachMessageInput {
  /** The recipient's full name if they're in the directory. */
  recipientName: string | null;
  propertyAddress: string;
  unsubscribeUrl: string;
  config: EmailConfig;
}

/**
 * The email that carries a snapshot/indication PDF to a realtor or mortgage
 * broker. Written as a genuine, relevant business email — it says who we are,
 * what's attached and why, and ends with the postal address and unsubscribe
 * link CAN-SPAM requires. Deliberately signed by the agency, not a named person.
 */
export function buildOutreachMessage({ recipientName, propertyAddress, unsubscribeUrl, config }: OutreachMessageInput) {
  const first = recipientName?.trim().split(/\s+/)[0];
  const greeting = first ? `Hi ${first},` : "Hello,";
  const subject = `Insurance snapshot for ${propertyAddress}`;

  const paragraphs = [
    `We're Brightway Insurance | The Harrington Agency. We put together a one-page homeowners insurance snapshot for ${propertyAddress} — estimated premiums from several Florida carriers — so buyers can see what the home is likely to cost to insure before they write an offer. It's attached.`,
    "If you have a buyer interested in the property, reply with their name, phone number and email and we'll prepare a personalized quote.",
  ];

  const text = [
    greeting,
    "",
    ...paragraphs.flatMap((p) => [p, ""]),
    "Brightway Insurance | The Harrington Agency",
    `${CONTACT_EMAIL} | ${CONTACT_PHONE}`,
    "",
    "--",
    config.postalAddress,
    `Don't want these emails? Unsubscribe: ${unsubscribeUrl}`,
  ].join("\n");

  const html = `<!doctype html>
<html><body style="margin:0;padding:24px;background:#ffffff;font-family:Arial,Helvetica,sans-serif;color:#1e293b;font-size:15px;line-height:1.55;">
<div style="max-width:560px;">
<p style="margin:0 0 16px;">${escapeHtml(greeting)}</p>
${paragraphs.map((p) => `<p style="margin:0 0 16px;">${escapeHtml(p)}</p>`).join("\n")}
<p style="margin:0 0 4px;font-weight:bold;color:#003049;">Brightway Insurance | The Harrington Agency</p>
<p style="margin:0 0 24px;">${CONTACT_EMAIL} | ${CONTACT_PHONE}</p>
<hr style="border:none;border-top:1px solid #e2e8f0;margin:0 0 12px;">
<p style="margin:0 0 4px;font-size:12px;color:#64748b;">${escapeHtml(config.postalAddress)}</p>
<p style="margin:0;font-size:12px;color:#64748b;">Don't want these emails? <a href="${escapeHtml(unsubscribeUrl)}" style="color:#64748b;">Unsubscribe</a></p>
</div></body></html>`;

  return { subject, text, html };
}
