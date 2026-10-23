import Link from "next/link";
import Image from "next/image";
import brightwayLogo from "@/assets/branding/brightway-harrington-horizontal-deep-blue.png";
import brightwayMarkYellow from "@/assets/branding/brightway-mark-bright-yellow.png";
import { createServiceSupabase } from "@/lib/supabase/server";
import { resolvePublicAgent } from "@/lib/team/team";
import { SignupForm } from "./SignupForm";

// Matches lib/quote-requests/submit.ts's PUBLIC_FORM_AGENCY_ID — this app's one agency.
const PUBLIC_FORM_AGENCY_ID = "ccb0a58e-0b78-4799-b236-66d1bda42f67";

export default async function PartnerSignupPage({ searchParams }: { searchParams: Promise<{ agent?: string }> }) {
  const { agent } = await searchParams;
  // Only used to show the friendly "you'll be connected with X" note below —
  // the value that actually gets persisted is re-validated server-side in
  // signUpPartner, not trusted from this page render.
  const resolvedAgent = await resolvePublicAgent(createServiceSupabase(), PUBLIC_FORM_AGENCY_ID, agent);

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#003049] px-4 py-8">
      <Image
        src={brightwayMarkYellow}
        alt=""
        aria-hidden
        className="pointer-events-none absolute -bottom-24 -left-24 h-[28rem] w-[28rem] select-none opacity-90 md:h-[36rem] md:w-[36rem]"
        priority
      />
      <div className="relative w-full max-w-sm space-y-5 rounded-2xl bg-white p-8 shadow-xl">
        <div>
          <Image src={brightwayLogo} alt="Brightway Insurance | The Harrington Agency" className="h-auto w-52" priority />
          <div className="mt-4 h-[3px] w-full bg-[#F0FF00]" />
        </div>

        <div>
          <h1 className="text-lg font-semibold text-[#003049]">Create your partner account</h1>
          <p className="text-sm text-[#8291AC]">For realtors, mortgage brokers, and roofing companies</p>
        </div>

        <SignupForm agentId={resolvedAgent?.id ?? null} agentName={resolvedAgent?.fullName ?? null} />

        <p className="text-center text-xs text-[#8291AC]">
          Already have an account?{" "}
          <Link href="/partner/login" className="font-medium text-[#003049] underline">
            Log in
          </Link>
        </p>
      </div>
    </div>
  );
}
