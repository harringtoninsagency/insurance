"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { createBrowserSupabase } from "@/lib/supabase/client";
import brightwayLogo from "@/assets/branding/brightway-harrington-horizontal-deep-blue.png";

export default function LoginPage() {
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

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    setLoading(false);

    if (error) {
      setError(error.message);
      return;
    }

    router.push("/properties");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#003049] px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-5 rounded-2xl bg-white p-8 shadow-xl"
      >
        <div>
          <Image src={brightwayLogo} alt="Brightway Insurance | The Harrington Agency" className="h-auto w-52" priority />
          <div className="mt-4 h-[3px] w-full bg-[#F0FF00]" />
        </div>

        <div>
          <h1 className="text-lg font-semibold text-[#003049]">Agency workspace</h1>
          <p className="text-sm text-[#8291AC]">Sign in to continue to FetchRival</p>
        </div>

        {error && (
          <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        <div className="space-y-1">
          <label htmlFor="email" className="text-sm font-medium text-[#003049]">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            autoFocus
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#003049] focus:ring-2 focus:ring-[#003049]/20"
            suppressHydrationWarning
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="password" className="text-sm font-medium text-[#003049]">
            Password
          </label>
          <input
            id="password"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#003049] focus:ring-2 focus:ring-[#003049]/20"
            suppressHydrationWarning
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded bg-[#003049] px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-[#012333] disabled:opacity-50"
        >
          {loading ? "Signing in..." : "Sign in"}
        </button>

        <p className="text-center text-xs italic text-[#8291AC]">The brighter way to do insurance.</p>
      </form>
    </div>
  );
}
