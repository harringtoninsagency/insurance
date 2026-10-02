"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { createBrowserSupabase } from "@/lib/supabase/client";
import { establishSessionFromUrl } from "@/lib/supabase/establish-session";
import brightwayLogo from "@/assets/branding/brightway-harrington-horizontal-deep-blue.png";
import { activatePartnerAccountAction } from "./actions";

// Supabase's invite email links here with the recovery/invite token already
// in the URL; the browser client (detectSessionInUrl, on by default) turns
// that into a real session before this component's effects run — nothing
// here needs to parse the URL itself.
export default function AcceptInvitePage() {
  const router = useRouter();
  const supabase = createBrowserSupabase();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    establishSessionFromUrl(supabase).then(setReady);
  }, [supabase]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Please use at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Those passwords don't match.");
      return;
    }
    setLoading(true);

    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setLoading(false);
      setError(updateError.message);
      return;
    }

    const result = await activatePartnerAccountAction();
    setLoading(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }

    router.push("/partner");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#003049] px-4">
      <div className="w-full max-w-sm space-y-5 rounded-2xl bg-white p-8 shadow-xl">
        <div>
          <Image src={brightwayLogo} alt="Brightway Insurance | The Harrington Agency" className="h-auto w-52" priority />
          <div className="mt-4 h-[3px] w-full bg-[#F0FF00]" />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-[#003049]">Set up your partner account</h1>
          <p className="text-sm text-[#8291AC]">Choose a password to finish activating your invitation.</p>
        </div>

        {!ready ? (
          <p className="text-sm text-slate-500">
            This invite link looks like it&apos;s expired or already used. Ask your Brightway representative to send
            a new one.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            <div className="space-y-1">
              <label htmlFor="password" className="text-sm font-medium text-[#003049]">
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-[#003049] focus:outline-none"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="confirm" className="text-sm font-medium text-[#003049]">
                Confirm password
              </label>
              <input
                id="confirm"
                type="password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-[#003049] focus:outline-none"
              />
            </div>
            <button type="submit" disabled={loading} className="w-full rounded bg-[#003049] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
              {loading ? "Setting up..." : "Activate my account"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
