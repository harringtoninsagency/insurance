import type { Metadata } from "next";
import Image from "next/image";
import brightwayLogo from "@/assets/branding/brightway-harrington-horizontal-deep-blue.png";
import { QuoteForm } from "./QuoteForm";

// Unlike app/request-quote (noindex — a direct-link form for partners and
// producers to hand someone), this page is the actual public front door:
// the "Quote app access and front doors" plan's homeowner re-shop funnel,
// linked from the news site and social, so it should be found and shared.
export const metadata: Metadata = {
  title: "Free Florida Home Insurance Quote | Brightway Insurance",
  description:
    "Florida home insurance rates are dropping. See your options from multiple top-rated carriers in under a minute — no obligation.",
  openGraph: {
    title: "Is Your Florida Home Insurance Renewal Outrageous?",
    description: "See your options from multiple top-rated Florida carriers in under a minute.",
    type: "website",
  },
};

export default function ConsumerQuotePage() {
  return (
    <div className="min-h-screen bg-[#F7F9FC]">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-2xl px-5 py-4">
          <Image src={brightwayLogo} alt="Brightway Insurance | The Harrington Agency" className="h-auto w-56 max-w-full" priority />
        </div>
        <div className="h-[3px] w-full bg-[#F0FF00]" />
      </header>

      <main className="mx-auto max-w-2xl px-5 py-10">
        <div className="text-center">
          <h1 className="text-4xl font-bold leading-tight text-[#003049] sm:text-5xl">Is Your Florida Home Insurance Renewal Outrageous?</h1>
          <p className="mx-auto mt-4 max-w-xl text-base leading-7 text-slate-600">
            Rates are dropping across Florida as new carriers compete for your business. See your options from
            multiple top-rated carriers in under a minute — free, no obligation.
          </p>
        </div>

        <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <QuoteForm />
        </div>

        <div className="mt-10 grid gap-6 text-center sm:grid-cols-3">
          <div>
            <div className="text-2xl font-bold text-[#003049]">60 sec</div>
            <div className="mt-1 text-xs text-slate-500">to request your estimate</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-[#003049]">Multiple</div>
            <div className="mt-1 text-xs text-slate-500">top-rated Florida carriers compared</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-[#003049]">Licensed</div>
            <div className="mt-1 text-xs text-slate-500">Florida agents, not a call center</div>
          </div>
        </div>

        <p className="mt-10 text-center text-xs text-slate-400">Brightway Insurance | The Harrington Agency</p>
      </main>
    </div>
  );
}
