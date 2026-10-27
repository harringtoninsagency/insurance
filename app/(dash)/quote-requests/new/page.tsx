import { NewQuoteForm } from "./NewQuoteForm";
import { BackLink } from "@/app/BackLink";
import { sessionContext } from "@/lib/contacts/session";

export const metadata = { title: "Run a quote" };

export default async function NewQuotePage() {
  // The referral-partner co-branding picker's options — same contact
  // types resolveReferralPartnerContact accepts. Not RLS-scoped any
  // differently than the rest of this dashboard: the signed-in session's
  // own "agency scoped" policy on industry_contacts already limits this.
  const { supabase } = await sessionContext();
  const { data: contacts } = await supabase
    .from("industry_contacts")
    .select("id, full_name, company_name")
    .eq("do_not_contact", false)
    .in("contact_type", ["realtor", "mortgage_broker", "roofing_company"])
    .order("full_name");

  return (
    <div className="max-w-2xl">
      <BackLink href="/quote-requests" label="Quote requests" />
      <h1 className="mt-2 text-xl font-semibold text-[#003049]">Run a property insurance quote</h1>
      <div className="mb-2 mt-2 h-[3px] w-16 bg-[#F0FF00]" />
      <p className="mb-6 text-sm text-slate-500">
        Enter an address and we&apos;ll match it to county records and queue it for carrier quotes. A quote run starts right
        away, so results usually appear on the property page within a few minutes; if it can&apos;t start, the hourly run
        picks it up.
      </p>
      <div className="rounded-lg border border-slate-200 bg-white p-6">
        <NewQuoteForm referralPartners={(contacts ?? []).map((c) => ({ id: c.id, fullName: c.full_name, companyName: c.company_name }))} />
      </div>
    </div>
  );
}
