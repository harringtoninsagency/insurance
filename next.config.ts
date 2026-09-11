import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // lib/proposals/generate-indication.ts reads these PNGs off disk at
  // runtime (not a static import), so Vercel's build-time file tracer needs
  // an explicit hint to bundle them into the server function — otherwise
  // proposal generation would 404/ENOENT in production despite working
  // locally, since process.cwd() is the deployed function's own root there.
  outputFileTracingIncludes: {
    "/**": ["./assets/branding/**"],
  },
  // Server Actions default to a 1MB request body limit — too small for a
  // real listing photo uploaded via PhotoUploadForm.tsx/uploadListingPhotoAction,
  // which routinely run several MB straight from an MLS export.
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
