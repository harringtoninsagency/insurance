// The app's public domain, used to build absolute links in invite/reset/
// outreach emails and shareable partner-portal links. Falls back to a known
// Vercel deployment URL if APP_BASE_URL isn't set — only ever hit in a
// misconfigured environment (production has it set; see .env.example/docs).
const DEFAULT_BASE_URL = "https://insurance-rust-five.vercel.app";

export function appBaseUrl(): string {
  return (process.env.APP_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
}
