import type { MetadataRoute } from "next";

// Next.js serves this at /manifest.webmanifest automatically — what makes
// the app installable ("Add to Home Screen" / browser install prompt) on
// both the internal dashboard and the partner portal, since both are under
// this same root layout/origin. No native app, no App Store: this is the
// PWA-install layer discussed for "mobile version."
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "FetchRival — Brightway Insurance",
    short_name: "FetchRival",
    description: "Florida homeowners insurance listing-to-proposal app",
    start_url: "/",
    display: "standalone",
    background_color: "#003049",
    theme_color: "#003049",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
