"use client";

import { useEffect, useState } from "react";

// navigator.share with a files array (Web Share API Level 2) is what lets a
// phone hand the image straight to Messages/Instagram/etc. as an attachment
// instead of just sharing a link — only available on supporting
// mobile browsers, so this falls back to a plain download link everywhere
// else rather than failing silently.
export function ShareImageActions({ imageUrl, shareText }: { imageUrl: string; shareText: string }) {
  const [canShareFiles, setCanShareFiles] = useState(false);
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    setCanShareFiles("share" in navigator && "canShare" in navigator);
  }, []);

  async function shareImage() {
    setSharing(true);
    try {
      const res = await fetch(imageUrl);
      const blob = await res.blob();
      const file = new File([blob], "brightway-partner-share.png", { type: "image/png" });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], text: shareText });
      } else {
        await navigator.share({ text: shareText, url: imageUrl });
      }
    } catch {
      // Cancelling the native share sheet also throws — nothing to recover
      // from, the download link below still works.
    } finally {
      setSharing(false);
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      {canShareFiles && (
        <button
          type="button"
          onClick={shareImage}
          disabled={sharing}
          className="rounded-full bg-[#F0FF00] px-4 py-2 text-sm font-bold text-[#003049] transition-colors hover:brightness-95 disabled:opacity-60"
        >
          {sharing ? "Opening..." : "Share..."}
        </button>
      )}
      <a
        href={imageUrl}
        download="brightway-partner-share.png"
        className="rounded-full border border-[#003049] px-4 py-2 text-sm font-semibold text-[#003049] transition-colors hover:bg-[#003049]/5"
      >
        Download image
      </a>
    </div>
  );
}
