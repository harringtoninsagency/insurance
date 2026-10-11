import Link from "next/link";
import Image from "next/image";
import brightwayLogo from "@/assets/branding/brightway-harrington-horizontal-deep-blue.png";
import brightwayMarkYellow from "@/assets/branding/brightway-mark-bright-yellow.png";
import { SignupForm } from "./SignupForm";

export default function PartnerSignupPage() {
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
          <p className="text-sm text-[#8291AC]">For realtors and mortgage brokers</p>
        </div>

        <SignupForm />

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
