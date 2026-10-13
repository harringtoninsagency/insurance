"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { createBrowserSupabase } from "@/lib/supabase/client";
import brightwayLogo from "@/assets/branding/brightway-harrington-horizontal-deep-blue.png";
import brightwayMarkYellow from "@/assets/branding/brightway-mark-bright-yellow.png";

export default function PartnerLoginPage() {
  const router = useRouter();
  const supabase = createBrowserSupabase();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);

    if (error) {
      setError(error.message);
      return;
    }

    router.push("/partner");
    router.refresh();
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#003049] px-4">
      <Image
        src={brightwayMarkYellow}
        alt=""
        aria-hidden
        className="pointer-events-none absolute -bottom-24 -left-24 h-[28rem] w-[28rem] select-none opacity-90 md:h-[36rem] md:w-[36rem]"
        priority
      />
      <form onSubmit={handleSubmit} className="relative w-full max-w-sm space-y-5 rounded-2xl bg-white p-8 shadow-xl">
        <div>
          <Image src={brightwayLogo} alt="Brightway Insurance | The Harrington Agency" className="h-auto w-52" priority />
          <div className="mt-4 h-[3px] w-full bg-[#F0FF00]" />
        </div>

        <div>
          <h1 className="text-lg font-semibold text-[#003049]">Partner portal</h1>
          <p className="text-sm text-[#8291AC]">For invited realtors and mortgage brokers</p>
        </div>

        {error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <div className="space-y-1">
          <label htmlFor="email" className="text-sm font-medium text-[#003049]">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-[#003049] focus:outline-none"
          />
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <label htmlFor="password" className="text-sm font-medium text-[#003049]">
              Password
            </label>
            <Link href="/forgot-password" className="text-xs text-[#003049] underline">
              Forgot password?
            </Link>
          </div>
          <input
            id="password"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-[#003049] focus:outline-none"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-full bg-[#F0FF00] px-4 py-2.5 text-sm font-bold text-[#003049] transition-colors hover:brightness-95 disabled:opacity-50"
        >
          {loading ? "Signing in..." : "Sign in"}
        </button>

        <Link
          href="/partner/signup"
          className="block w-full rounded-full border border-[#003049] px-4 py-2.5 text-center text-sm font-bold text-[#003049] transition-colors hover:bg-[#003049]/5"
        >
          Sign up for new account
        </Link>
      </form>
    </div>
  );
}
