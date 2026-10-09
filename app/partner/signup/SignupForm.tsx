"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase/client";
import { signUpPartnerAction } from "./actions";
import type { SelfSignupResult } from "@/lib/partners/self-signup";

const inputClass = "w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-[#003049] focus:outline-none";

export function SignupForm() {
  const router = useRouter();
  const supabase = createBrowserSupabase();
  const [state, formAction, isPending] = useActionState<SelfSignupResult | null, FormData>(signUpPartnerAction, null);

  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [signingIn, setSigningIn] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);

  useEffect(() => {
    if (!state?.ok) return;
    setSigningIn(true);
    const phoneDigits = phone.replace(/\D/g, "");
    supabase.auth.signInWithPassword({ email, password: phoneDigits }).then(({ error }) => {
      if (error) {
        setSignInError("Account created, but signing you in automatically failed — try logging in with your email and 10-digit phone number.");
        setSigningIn(false);
        return;
      }
      router.push("/partner");
      router.refresh();
    });
    // Only re-run if a fresh successful submission comes in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <form action={formAction} className="space-y-5">
      <div className="space-y-1">
        <label htmlFor="full_name" className="text-sm font-medium text-[#003049]">
          Full name
        </label>
        <input id="full_name" name="full_name" type="text" required className={inputClass} />
      </div>

      <div className="space-y-1">
        <label htmlFor="contact_type" className="text-sm font-medium text-[#003049]">
          I am a
        </label>
        <select id="contact_type" name="contact_type" required defaultValue="" className={inputClass}>
          <option value="" disabled>
            Choose one
          </option>
          <option value="realtor">Realtor</option>
          <option value="mortgage_broker">Mortgage broker</option>
        </select>
      </div>

      <div className="space-y-1">
        <label htmlFor="email" className="text-sm font-medium text-[#003049]">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputClass}
        />
        <p className="text-xs text-slate-500">This is your login ID.</p>
      </div>

      <div className="space-y-1">
        <label htmlFor="phone" className="text-sm font-medium text-[#003049]">
          Phone number
        </label>
        <input
          id="phone"
          name="phone"
          type="tel"
          inputMode="numeric"
          required
          placeholder="10 digits, e.g. 7275551234"
          pattern="^\D*\d(?:\D*\d){9}\D*$"
          title="Enter a 10-digit phone number"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className={inputClass}
        />
        <p className="text-xs text-slate-500">Your 10-digit phone number is your password — write it down.</p>
      </div>

      {state && !state.ok && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
      {signInError && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{signInError}</p>}

      <button
        type="submit"
        disabled={isPending || signingIn}
        className="w-full rounded bg-[#003049] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
      >
        {isPending ? "Creating account..." : signingIn ? "Signing you in..." : "Create account"}
      </button>
    </form>
  );
}
