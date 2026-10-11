"use client";

import { useEffect } from "react";

/**
 * Safety net for a Supabase password-reset or invite link that lands here
 * instead of /set-password (e.g. if Supabase's redirect_to is ever dropped
 * again due to a URL-allowlist misconfiguration — confirmed happening live,
 * see ticket SU-502186). The recovery/invite token arrives as a URL hash
 * fragment, which only exists client-side, so a server component here can
 * never see it -- this runs once on mount and forwards it to /set-password,
 * which already knows how to turn that fragment into a session.
 */
export function RecoveryRedirect() {
  useEffect(() => {
    const hash = window.location.hash;
    if (hash.includes("type=recovery") || hash.includes("type=invite")) {
      window.location.replace(`/set-password${hash}`);
    }
  }, []);

  return null;
}
