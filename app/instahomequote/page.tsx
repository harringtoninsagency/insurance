import type { Metadata } from "next";
import { QuoteForm } from "@/app/quote/QuoteForm";
import { CONTACT_PHONE } from "@/lib/contacts/consent-text";

// InstaHomeQuote — a separately branded, separately marketed front door onto
// the exact same submission pipeline as app/quote (see app/quote/actions.ts's
// submitConsumerQuoteAction, which reads the Host header to tell the two
// apart for tracking/notification purposes only). Served at "/" on
// instahomequote.com/www.instahomequote.com via next.config.ts's host-based
// rewrite — this route itself is never linked to from the main site.
export const metadata: Metadata = {
  title: "InstaHomeQuote | Instant Florida Home Insurance Quotes",
  description: "Get your Florida home insurance quote in under a minute. Compare rates from multiple top-rated carriers — free, no obligation.",
  openGraph: {
    title: "Florida Home Insurance, Instantly Quoted",
    description: "Compare rates from multiple top-rated Florida carriers in under a minute — free, no obligation.",
    type: "website",
  },
};

export default function InstaHomeQuotePage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-[#003049] to-[#00243a]">
      <header className="px-5 py-6 text-center">
        <div className="text-2xl font-black tracking-tight text-white">
          Insta<span className="text-[#F0FF00]">Home</span>Quote
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-5 pb-16">
        <div className="text-center">
          <h1 className="text-4xl font-bold leading-tight text-white sm:text-5xl">
            Florida Home Insurance, <span className="text-[#F0FF00]">Instantly Quoted.</span>
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-base leading-7 text-slate-200">
            Stop overpaying. See your options from multiple top-rated Florida carriers in under 60 seconds — free,
            no obligation, no pushy calls.
          </p>
        </div>

        <div className="mt-8 rounded-2xl border border-white/10 bg-white p-6 shadow-xl sm:p-8">
          <h2 className="mb-5 text-center text-lg font-bold text-[#003049]">Get My Instant Quote</h2>
          <QuoteForm />
        </div>

        <div className="mt-10 grid gap-6 text-center sm:grid-cols-3">
          <div>
            <div className="text-2xl font-bold text-[#F0FF00]">60 sec</div>
            <div className="mt-1 text-xs text-slate-300">to request your estimate</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-[#F0FF00]">Multiple</div>
            <div className="mt-1 text-xs text-slate-300">top-rated Florida carriers compared</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-[#F0FF00]">$0</div>
            <div className="mt-1 text-xs text-slate-300">cost, obligation, or spam calls</div>
          </div>
        </div>

        <p className="mx-auto mt-10 max-w-xl text-center text-xs leading-5 text-slate-400">
          Rates shown are estimates based on assumed wind-mitigation credits and property details on file; a four
          point or wind mitigation inspection may be required to verify eligibility and finalize actual premiums.
        </p>

        <div className="mt-8 border-t border-white/10 pt-6 text-center text-xs text-slate-400">
          <p>Insurance quotes provided by Brightway Insurance | The Harrington Agency</p>
          <p className="mt-1">Phone: {CONTACT_PHONE}</p>
        </div>
      </main>
    </div>
  );
}
