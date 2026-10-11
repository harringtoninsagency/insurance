import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { RecoveryRedirect } from "./RecoveryRedirect";
import brightwayMarkYellow from "@/assets/branding/brightway-mark-bright-yellow.png";

// The entry point for anyone not already signed in: pick a portal instead of
// guessing which one they need. An already-authenticated visitor skips this
// and goes straight to their own portal -- team members have a profiles row,
// partners (realtors/mortgage brokers) don't (see app/(dash)/layout.tsx for
// the same check).
export default async function Home() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    const { data: profile } = await supabase.from("profiles").select("id").eq("id", user.id).maybeSingle();
    redirect(profile ? "/properties" : "/partner");
  }

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-[#003049]">
      <RecoveryRedirect />
      <Image
        src={brightwayMarkYellow}
        alt=""
        aria-hidden
        className="pointer-events-none absolute -bottom-24 -left-24 h-[28rem] w-[28rem] select-none opacity-90 md:h-[36rem] md:w-[36rem]"
        priority
      />
      <header className="relative flex justify-end p-6">
        <Link href="/" aria-label="Brightway Insurance | The Harrington Agency home">
          <Image src={brightwayMarkYellow} alt="Brightway Insurance | The Harrington Agency" className="h-10 w-10" priority />
        </Link>
      </header>

      <main className="relative flex flex-1 flex-col items-center justify-center gap-10 px-4 pb-16">
        <div className="text-center">
          <h1 className="text-7xl font-semibold text-[#F0FF00] sm:text-8xl">Brightway Insurance | The Harrington Agency</h1>
          <div className="mx-auto mt-3 h-[3px] w-16 bg-[#F0FF00]" />
          <p className="mt-3 text-sm text-[#8291AC]">Choose how you&apos;d like to sign in.</p>
        </div>

        <div className="grid w-full max-w-2xl gap-6 sm:grid-cols-2">
          <Link
            href="/partner/login"
            className="group flex flex-col items-center rounded-2xl bg-white p-8 text-center shadow-lg transition hover:shadow-xl"
          >
            <h2 className="text-lg font-semibold text-[#003049]">Referral Partner Portal</h2>
            <p className="mt-2 text-sm text-slate-500">
              For Realtors and mortgage brokers — submit and track quote requests.
            </p>
            <span className="mt-5 rounded-full bg-[#F0FF00] px-5 py-2 text-sm font-bold text-[#003049] transition-colors group-hover:brightness-95">
              Sign in
            </span>
          </Link>

          <Link
            href="/login"
            className="group flex flex-col items-center rounded-2xl bg-white p-8 text-center shadow-lg transition hover:shadow-xl"
          >
            <h2 className="text-lg font-semibold text-[#003049]">Team Member Portal</h2>
            <p className="mt-2 text-sm text-slate-500">For Brightway Insurance agents and staff.</p>
            <span className="mt-5 rounded-full bg-[#F0FF00] px-5 py-2 text-sm font-bold text-[#003049] transition-colors group-hover:brightness-95">
              Sign in
            </span>
          </Link>
        </div>
      </main>
    </div>
  );
}
