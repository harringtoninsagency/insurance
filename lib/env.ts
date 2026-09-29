import { resolve, dirname } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Loads .env.local when it exists — a local machine running a script by
 * hand — and does nothing when it doesn't: this app's own deployed server,
 * or a scheduled cloud routine, both get real credentials as actual process
 * environment variables instead, set by the platform before the process
 * starts. `process.loadEnvFile` throws on a missing path, so every script
 * that wants local credentials should call this instead of calling that
 * directly (see docs/process-quote-requests.md, which does exactly this).
 *
 * Resolves the repo root from this file's own location (lib/), not the
 * caller's, so it works the same regardless of how deep the calling script
 * lives.
 */
export function loadEnvIfPresent(): void {
  const here = typeof import.meta.dirname === "string" ? import.meta.dirname : dirname(fileURLToPath(import.meta.url));
  const envPath = resolve(here, "../.env.local");
  if (existsSync(envPath)) process.loadEnvFile(envPath);

  // The scheduled cloud routine's sandbox routes all outbound traffic
  // through an egress proxy (CCR's agent-proxy, advertised via
  // HTTPS_PROXY/https_proxy) — a direct connection to any non-preapproved
  // host (Supabase included) is refused by the sandbox's own network layer
  // with "Host not in allowlist", regardless of that proxy's own allowlist
  // state. Node's built-in fetch (undici) does NOT honor HTTPS_PROXY unless
  // this flag is set — confirmed live: identical Supabase calls failed with
  // that exact error until this was set, even after the proxy's allowlist
  // itself had already been corrected. Harmless everywhere else (local dev,
  // Vercel) since HTTPS_PROXY is unset there and this is a no-op.
  process.env.NODE_USE_ENV_PROXY ??= "1";
}
