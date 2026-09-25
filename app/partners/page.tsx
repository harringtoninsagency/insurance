import type { Metadata } from "next";
import Image from "next/image";
import brightwayLogo from "@/assets/branding/brightway-harrington-horizontal-deep-blue.png";
import { OptInForm } from "./OptInForm";

export const metadata: Metadata = {
  title: "Insurance snapshots for your listings | Brightway Insurance",
  description: "New-listing homeowners insurance snapshots for Florida real estate agents and mortgage brokers.",
  // A share-by-link sign-up page; no reason for search engines to list it.
  robots: { index: false, follow: false },
};

export default function PartnersPage() {
  return (
    <div className="mx-auto max-w-2xl px-5 py-10">
      <Image src={brightwayLogo} alt="Brightway Insurance | The Harrington Agency" className="h-auto w-72 max-w-full" priority />
      <div className="mb-8 mt-4 h-[3px] w-full bg-[#F0FF00]" />

      <h1 className="text-2xl font-semibold text-[#003049]">Insurance snapshots for your listings</h1>
      <p className="mt-3 text-sm leading-6 text-slate-700">
        Buyers want to know what a home will cost to insure before they write an offer. For new Florida listings we
        prepare a one-page snapshot with estimated homeowners premiums from multiple carriers, so you can share real
        numbers with your buyers early. Tell us where to send them.
      </p>

      <ul className="mt-4 space-y-1.5 text-sm text-slate-700">
        <li className="flex gap-2">
          <span className="text-[#003049]">&#10003;</span> Starting premium and several carrier options per property
        </li>
        <li className="flex gap-2">
          <span className="text-[#003049]">&#10003;</span> Property details and insurance readiness at a glance
        </li>
        <li className="flex gap-2">
          <span className="text-[#003049]">&#10003;</span> A personalized quote for your buyer on request
        </li>
      </ul>

      <div className="mt-8 rounded-lg border border-slate-200 bg-white p-6">
        <OptInForm />
      </div>

      <p className="mt-6 text-xs text-slate-400">Brightway Insurance | The Harrington Agency</p>
    </div>
  );
}
