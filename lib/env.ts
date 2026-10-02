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

  // NOTE on the cloud routine's egress proxy: its sandbox routes all
  // outbound traffic through an agent-proxy (HTTPS_PROXY/https_proxy), and a
  // direct connection to Supabase is refused by the sandbox's own network
  // layer ("Host not in allowlist") unless Node's fetch is told to honor
  // that proxy via NODE_USE_ENV_PROXY=1. Setting `process.env.NODE_USE_ENV_PROXY`
  // from HERE does NOT work — confirmed live, twice: ES module imports are
  // evaluated before any top-level statement in the importing file runs, so
  // `@supabase/supabase-js` (imported after this function textually, but
  // resolved before this function's body executes) has already initialized
  // its fetch/undici dispatcher by the time this line would run. The only
  // fix that has worked is setting the env var before the Node process
  // starts at all — see the "Credentials" section of
  // docs/process-quote-requests.md, which now requires prefixing every
  // script invocation with `NODE_USE_ENV_PROXY=1`.
}
