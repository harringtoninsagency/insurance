// Everything needed to send outreach email, read from the environment.
// Sending is refused unless all of it is present: CAN-SPAM requires a physical
// postal address and a working unsubscribe in every marketing email, so those
// are treated as required configuration, not optional extras.

export interface EmailConfig {
  apiKey: string;
  /** e.g. "Brightway Insurance | The Harrington Agency <harringtonagency@brightway.com>" */
  from: string;
  replyTo: string | null;
  /** Physical postal address printed in every email footer. */
  postalAddress: string;
  /** Secret used to sign unsubscribe links. */
  unsubscribeSecret: string;
  /** Public origin of this app, used to build unsubscribe links. */
  baseUrl: string;
}

const DEFAULT_BASE_URL = "https://insurance-rust-five.vercel.app";

const REQUIRED: Array<[keyof NodeJS.ProcessEnv & string, string]> = [
  ["RESEND_API_KEY", "Resend API key"],
  ["OUTREACH_FROM", "sender name and address"],
  ["OUTREACH_POSTAL_ADDRESS", "agency postal address for the email footer"],
  ["UNSUBSCRIBE_SECRET", "secret for signing unsubscribe links"],
];

export type EmailConfigResult = { ok: true; config: EmailConfig } | { ok: false; missing: string[] };

export function loadEmailConfig(env: NodeJS.ProcessEnv = process.env): EmailConfigResult {
  const missing = REQUIRED.filter(([name]) => !env[name]?.trim()).map(([name, what]) => `${name} (${what})`);
  if (missing.length) return { ok: false, missing };
  return {
    ok: true,
    config: {
      apiKey: env.RESEND_API_KEY!.trim(),
      from: env.OUTREACH_FROM!.trim(),
      replyTo: env.OUTREACH_REPLY_TO?.trim() || null,
      postalAddress: env.OUTREACH_POSTAL_ADDRESS!.trim(),
      unsubscribeSecret: env.UNSUBSCRIBE_SECRET!.trim(),
      baseUrl: (env.APP_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, ""),
    },
  };
}
