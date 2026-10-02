"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { createBrowserSupabase } from "@/lib/supabase/client";
import brightwayLogo from "@/assets/branding/brightway-harrington-horizontal-deep-blue.png";

export default function ForgotPasswordPage() {
  const supabase = createBrowserSupabase();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    // Same answer whether or not the address has an account — never reveal who does.
    await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/set-password` });
    setLoading(false);
    setSent(true);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#003049] px-4">
      <div className="w-full max-w-sm space-y-5 rounded-2xl bg-white p-8 shadow-xl">
        <div>
          <Image src={brightwayLogo} alt="Brightway Insurance | The Harrington Agency" className="h-auto w-52" priority />
          <div className="mt-4 h-[3px] w-full bg-[#F0FF00]" />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-[#003049]">Reset your password</h1>
          <p className="text-sm text-[#8291AC]">We&apos;ll email you a link to choose a new one.</p>
        </div>

        {sent ? (
          <p className="rounded bg-green-50 px-3 py-2 text-sm text-green-800">
            If that email has an account, a reset link is on its way. It can take a minute or two.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1">
              <label htmlFor="email" className="text-sm font-medium text-[#003049]">Email</label>
              <input
                id="email"
                type="email"
                required
                autoFocus
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-[#003049] focus:outline-none"
              />
            </div>
            <button type="submit" disabled={loading} className="w-full rounded bg-[#003049] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
              {loading ? "Sending..." : "Email me a reset link"}
            </button>
          </form>
        )}

        <p className="text-center text-sm">
          <Link href="/login" className="text-[#003049] underline">Back to sign in</Link>
        </p>
      </div>
    </div>
  );
}
