"use client";

import { useState } from "react";

export function CopyLinkButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be denied (permissions, insecure context) —
      // the link is already shown in full text above, so copying by hand
      // still works either way.
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="rounded-full bg-[#F0FF00] px-4 py-2 text-sm font-bold text-[#003049] transition-colors hover:brightness-95"
    >
      {copied ? "Copied!" : "Copy link"}
    </button>
  );
}
