"use client";

import { useRouter } from "next/navigation";

/** Returns to wherever the user came from — the previous page or menu section, via browser history. */
export function BackButton({ className = "" }: { className?: string }) {
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={() => router.back()}
      aria-label="Go back"
      className={`text-2xl font-bold leading-none text-[#003049] hover:text-[#003049]/70 ${className}`}
    >
      ←
    </button>
  );
}
