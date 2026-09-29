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
}
