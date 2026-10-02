import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Turns an emailed invite / password-reset link into a signed-in session.
 *
 * Links generated server-side (admin invite, an admin-triggered reset) carry
 * the tokens in the URL fragment (`#access_token=...`). This app's browser
 * client (@supabase/ssr) runs in PKCE mode, whose automatic URL detection
 * rejects that fragment form — so a fresh invitee would land with no session
 * and a "link expired" screen. Read the fragment ourselves and hand it to
 * setSession. A browser-initiated reset (/forgot-password) arrives as
 * `?code=...` instead, which the client exchanges on its own, so the plain
 * getSession() fallback covers that.
 *
 * Browser-only.
 */
export async function establishSessionFromUrl(supabase: SupabaseClient): Promise<boolean> {
  const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const accessToken = fragment.get("access_token");
  const refreshToken = fragment.get("refresh_token");

  if (accessToken && refreshToken) {
    const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
    // Don't leave single-use tokens sitting in the address bar / history.
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    return !error;
  }

  const { data } = await supabase.auth.getSession();
  return !!data.session;
}
