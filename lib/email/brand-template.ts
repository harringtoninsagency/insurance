import { appBaseUrl } from "@/lib/base-url";

// Brightway Brand Guidelines 2024 color palette — same values used by the
// proposal PDF generators (lib/proposals/generate-indication.ts /
// generate-listing-snapshot.ts), so an attached PDF and the email that
// carries it read as the same brand.
export const DEEP_BLUE = "#003049";
export const BRIGHT_YELLOW = "#F0FF00";
export const SLATE_TEXT = "#1e293b";
export const SLATE_MUTED = "#64748b";

// public/email-brightway-logo.png — a resized copy of
// assets/branding/brightway-harrington-horizontal-deep-blue.png. Email HTML
// needs a plain, stable, absolute URL (recipients' mail clients fetch it
// directly), which assets/ can't give: those files are only ever imported
// through Next's image pipeline and come out as hashed /_next/static/media
// paths at build time, not something a plain Node script building an email
// string can reference.
const LOGO_PATH = "/email-brightway-logo.png";

/**
 * Wraps `bodyHtml` in the shared Brightway email shell: logo header, yellow
 * accent rule, consistent typography — the same header treatment as the
 * proposal PDFs. `bodyHtml` is the caller's own fully-formed inner markup
 * (already using inline styles, since email clients vary widely in CSS
 * support); this only owns the outer chrome.
 */
export function brandedEmailShell(bodyHtml: string): string {
  const logoUrl = `${appBaseUrl()}${LOGO_PATH}`;
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden;">
            <tr>
              <td style="padding:28px 32px 16px;">
                <img src="${logoUrl}" alt="Brightway Insurance | The Harrington Agency" width="200" style="display:block;height:auto;border:0;">
              </td>
            </tr>
            <tr>
              <td style="height:3px;line-height:3px;font-size:0;background-color:${BRIGHT_YELLOW};">&nbsp;</td>
            </tr>
            <tr>
              <td style="padding:24px 32px 32px;color:${SLATE_TEXT};font-size:15px;line-height:1.6;">
                ${bodyHtml}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/** The agency sign-off block every branded email ends its main body with. */
export function brandedSignatureHtml(contactEmail: string, contactPhone: string): string {
  return `<p style="margin:0 0 4px;font-weight:bold;color:${DEEP_BLUE};">Brightway Insurance | The Harrington Agency</p>
<p style="margin:0;color:${SLATE_MUTED};">${contactEmail} | ${contactPhone}</p>`;
}
