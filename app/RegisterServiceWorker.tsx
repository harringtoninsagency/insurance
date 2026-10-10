"use client";

import { useEffect } from "react";

/** Registers the no-op service worker (public/sw.js) so the browser offers "Add to Home Screen" / install. */
export function RegisterServiceWorker() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Installability is a nice-to-have, not load-bearing — a failed
        // registration (e.g. unsupported browser) shouldn't surface anywhere.
      });
    }
  }, []);

  return null;
}
