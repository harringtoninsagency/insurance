"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createBrowserSupabase } from "@/lib/supabase/client";
import brightwayLogo from "@/assets/branding/brightway-harrington-horizontal-deep-blue.png";

// Where a given link type lands once confirmed -- each destination page
// already falls back to supabase.auth.getSession() when there's no token in
// its own URL (see lib/supabase/establish-session.ts), so the session we
// just established here carries straight through with no further wiring.
const DESTINATION: Partial<Record<EmailOtpType, string>> = {
  recovery: "/set-password",
  invite: "/partner/accept-invite",
};

/**
 * Deliberately requires a real click before touching Supabase at all.
 *
 * Supabase's recovery/invite links are single-use: the token is consumed by
 * whatever first requests it, no matter who or what that is. Corporate email
 * scanners (confirmed here: Microsoft 365 "Safe Links") fetch every link in
 * an email the moment it arrives, before a human ever opens the message --
 * silently burning the token and leaving the real recipient with "this link
 * looks expired or already used," every time, for every email.
 *
 * Email scanners fetch pages; they don't click buttons. So this page sits in
 * front of the actual token exchange and does nothing on load -- only
 * supabase.auth.verifyOtp() on an explicit click consumes the one-time
 * token, which keeps it alive for whoever actually taps the link.
 *
 * Reached from Supabase's email templates (Reset Password, Invite user),
 * which must link here instead of the default {{ .ConfirmationURL }}:
 * {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery (or type=invite)
 */
export default function ConfirmPage() {
  const router = useRouter();
  const supabase = createBrowserSupabase();
  const [params, setParams] = useState<{ tokenHash: string | null; type: EmailOtpType | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    setParams({ tokenHash: search.get("token_hash"), type: search.get("type") as EmailOtpType | null });
  }, []);

  async function handleConfirm() {
    if (!params?.tokenHash || !params.type) return;
    setLoading(true);
    const { error: verifyError } = await supabase.auth.verifyOtp({ token_hash: params.tokenHash, type: params.type });
    if (verifyError) {
      // A one-time token clicked a second time (e.g. re-opening the same
      // invite/reset email, or hitting "back" and tapping Continue again)
      // always fails here — that's correct, not a bug. But if the FIRST
      // click already succeeded in this same browser, there's already a
      // valid session sitting in local storage — send them on instead of
      // showing a dead-end "expired" error, which is exactly the confusing
      // "invalid link" complaint a second click on an already-used link
      // produces. Only show the error when there's truly no session.
      const { data } = await supabase.auth.getSession();
      setLoading(false);
      if (data.session) {
        router.push(DESTINATION[params.type] ?? "/");
        router.refresh();
        return;
      }
      setError("This link looks expired or already used. Ask for a new one.");
      return;
    }
    setLoading(false);
    router.push(DESTINATION[params.type] ?? "/");
    router.refresh();
  }

  const destination = params?.type ? DESTINATION[params.type] : undefined;
  const linkIsUsable = params && params.tokenHash && params.type && destination;

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#003049] px-4">
      <div className="w-full max-w-sm space-y-5 rounded-2xl bg-white p-8 text-center shadow-xl">
        <div>
          <Image src={brightwayLogo} alt="Brightway Insurance | The Harrington Agency" className="mx-auto h-auto w-52" priority />
          <div className="mx-auto mt-4 h-[3px] w-full bg-[#F0FF00]" />
        </div>

        {params === null ? null : !linkIsUsable ? (
          <p className="text-sm text-slate-500">
            This link is missing information and can&apos;t be used. Ask for a new one.
          </p>
        ) : (
          <>
            <p className="text-sm text-[#8291AC]">Tap below to continue.</p>
            {error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            <button
              type="button"
              onClick={handleConfirm}
              disabled={loading}
              className="w-full rounded-full bg-[#F0FF00] px-4 py-2.5 text-sm font-bold text-[#003049] transition-colors hover:brightness-95 disabled:opacity-50"
            >
              {loading ? "Confirming..." : "Continue"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
