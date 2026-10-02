"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { createBrowserSupabase } from "@/lib/supabase/client";
import brightwayLogo from "@/assets/branding/brightway-harrington-horizontal-deep-blue.png";

// Landing page for both a team invite and a password-reset email: Supabase's
// link arrives here with the token already in the URL and the browser client
// (detectSessionInUrl, on by default) turns it into a real session before
// these effects run — so there's nothing to parse here, only a password to set.
export default function SetPasswordPage() {
  const router = useRouter();
  const supabase = createBrowserSupabase();
  const [ready, setReady] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // The session can land a beat after first paint; check once, then again on the auth event.
    supabase.auth.getSession().then(({ data }) => setReady(!!data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) setReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, [supabase]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 10) {
      setError("Please use at least 10 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Those passwords don't match.");
      return;
    }
    setLoading(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    router.push("/properties");
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
          <h1 className="text-lg font-semibold text-[#003049]">Choose your password</h1>
          <p className="text-sm text-[#8291AC]">You&apos;ll use your email and this password to sign in.</p>
        </div>

        {ready === false ? (
          <p className="text-sm text-slate-600">
            This link looks expired or already used. Ask an admin to resend your invite, or use &ldquo;Forgot password&rdquo; on the sign-in page.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            <div className="space-y-1">
              <label htmlFor="password" className="text-sm font-medium text-[#003049]">New password</label>
              <input
                id="password"
                type="password"
                required
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-[#003049] focus:outline-none"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="confirm" className="text-sm font-medium text-[#003049]">Confirm password</label>
              <input
                id="confirm"
                type="password"
                required
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-[#003049] focus:outline-none"
              />
            </div>
            <button type="submit" disabled={loading || ready === null} className="w-full rounded bg-[#003049] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
              {loading ? "Saving..." : "Save password and sign in"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
