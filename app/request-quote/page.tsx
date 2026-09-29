import type { Metadata } from "next";
import Image from "next/image";
import brightwayLogo from "@/assets/branding/brightway-harrington-horizontal-deep-blue.png";
import { RequestQuoteForm } from "./RequestQuoteForm";

export const metadata: Metadata = {
  title: "Request a homeowners insurance quote",
  description: "Get an estimated homeowners insurance quote or a buyer-facing listing snapshot for a Florida property.",
  robots: { index: false, follow: false },
};

export default function RequestQuotePage() {
  return (
    <div className="mx-auto max-w-2xl px-5 py-10">
      <Image src={brightwayLogo} alt="Brightway Insurance | The Harrington Agency" className="h-auto w-72 max-w-full" priority />
      <div className="mb-8 mt-4 h-[3px] w-full bg-[#F0FF00]" />

      <h1 className="text-2xl font-semibold text-[#003049]">Request a homeowners insurance quote</h1>
      <p className="mt-3 text-sm leading-6 text-slate-700">
        Tell us about the property and we&apos;ll get back to you with estimated premiums from multiple Florida
        carriers — either a full quote summary, a buyer-facing listing snapshot, or both.
      </p>

      <div className="mt-8 rounded-lg border border-slate-200 bg-white p-6">
        <RequestQuoteForm />
      </div>

      <p className="mt-6 text-xs text-slate-400">Brightway Insurance | The Harrington Agency</p>
    </div>
  );
}
