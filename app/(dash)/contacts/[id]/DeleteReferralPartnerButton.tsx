"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteContactAction } from "../actions";

export function DeleteReferralPartnerButton({ contactId, fullName }: { contactId: string; fullName: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const handleClick = () => {
    if (!window.confirm(`Delete ${fullName}'s referral partner account? This removes them from the directory and can't be undone.`)) return;
    startTransition(async () => {
      const result = await deleteContactAction(contactId);
      if (result.ok) {
        router.push("/contacts");
      } else {
        setError(result.error);
      }
    });
  };

  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={isPending}
        onClick={handleClick}
        className="rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
      >
        {isPending ? "Deleting..." : "Delete Referral Partner Account"}
      </button>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
