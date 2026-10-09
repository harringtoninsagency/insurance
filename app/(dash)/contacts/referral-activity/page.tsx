import Link from "next/link";
import { createServerSupabase } from "@/lib/supabase/server";

interface PartnerRow {
  id: string;
  full_name: string;
  company_name: string | null;
  contact_type: "realtor" | "mortgage_broker";
  referral_partner_agent: string;
  quoteCount: number;
}

/**
 * Cross-tabs referral partners (realtors/brokers) against the in-house agent
 * each relationship is assigned to on their directory entry
 * (`referral_partner_agent`, set from the Add Contact form). "Active" is
 * measured by how many quote_requests their referred properties produced —
 * the one concrete, countable signal this app already has for "they sent us
 * business," as opposed to just being in the directory.
 */
export default async function ReferralActivityPage() {
  const supabase = await createServerSupabase();

  const { data: partners, error } = await supabase
    .from("industry_contacts")
    .select("id, full_name, company_name, contact_type, referral_partner_agent")
    .not("referral_partner_agent", "is", null)
    .order("full_name");

  const partnerIds = (partners ?? []).map((p) => p.id);
  const { data: quoteRequests } = partnerIds.length
    ? await supabase.from("quote_requests").select("contact_id").in("contact_id", partnerIds)
    : { data: [] };

  const countByContactId = new Map<string, number>();
  for (const r of quoteRequests ?? []) {
    if (!r.contact_id) continue;
    countByContactId.set(r.contact_id, (countByContactId.get(r.contact_id) ?? 0) + 1);
  }

  const rows: PartnerRow[] = (partners ?? []).map((p) => ({
    ...p,
    referral_partner_agent: p.referral_partner_agent!,
    quoteCount: countByContactId.get(p.id) ?? 0,
  }));

  const byAgent = new Map<string, PartnerRow[]>();
  for (const r of rows) {
    const bucket = byAgent.get(r.referral_partner_agent);
    if (bucket) bucket.push(r);
    else byAgent.set(r.referral_partner_agent, [r]);
  }
  for (const bucket of byAgent.values()) bucket.sort((a, b) => b.quoteCount - a.quoteCount);

  const agents = [...byAgent.keys()].sort((a, b) => {
    const totalA = byAgent.get(a)!.reduce((sum, r) => sum + r.quoteCount, 0);
    const totalB = byAgent.get(b)!.reduce((sum, r) => sum + r.quoteCount, 0);
    return totalB - totalA;
  });

  return (
    <div>
      <Link href="/contacts" className="text-xs text-slate-500 hover:underline">
        ← Realtors &amp; Brokers
      </Link>
      <h1 className="mt-2 text-xl font-semibold text-[#003049]">Referral partner activity</h1>
      <div className="mb-2 mt-2 h-[3px] w-16 bg-[#F0FF00]" />
      <p className="mb-6 text-sm text-slate-500">
        Realtors and mortgage brokers with a referral partner agent set, grouped by that agent and ranked by how many
        quote requests their referred properties have produced. A partner with no referral partner agent assigned
        yet won&apos;t show up here — set it from their contact entry.
      </p>

      {error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error.message}</p>}
      {!error && agents.length === 0 && (
        <p className="text-sm text-slate-500">
          No referral partners have an agent assigned yet. Set &quot;Referral partner agent&quot; when adding or editing a contact.
        </p>
      )}

      <div className="space-y-6">
        {agents.map((agent) => {
          const partnerRows = byAgent.get(agent)!;
          const total = partnerRows.reduce((sum, r) => sum + r.quoteCount, 0);
          return (
            <div key={agent} className="overflow-hidden rounded-lg border border-slate-200 bg-white">
              <div className="flex items-center justify-between bg-[#003049] px-4 py-3 text-white">
                <span className="font-medium">{agent}</span>
                <span className="text-xs text-white/80">{total} quote request{total === 1 ? "" : "s"} total</span>
              </div>
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-2">Partner</th>
                    <th className="px-4 py-2">Company</th>
                    <th className="px-4 py-2">Type</th>
                    <th className="px-4 py-2">Quote requests</th>
                  </tr>
                </thead>
                <tbody>
                  {partnerRows.map((r) => (
                    <tr key={r.id} className="border-t border-slate-100">
                      <td className="px-4 py-2">
                        <Link href={`/contacts/${r.id}`} className="font-medium text-[#003049] hover:underline">
                          {r.full_name}
                        </Link>
                      </td>
                      <td className="px-4 py-2 text-slate-600">{r.company_name ?? "—"}</td>
                      <td className="px-4 py-2 text-slate-600">{r.contact_type === "realtor" ? "Realtor" : "Mortgage broker"}</td>
                      <td className="px-4 py-2 text-slate-600">{r.quoteCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    </div>
  );
}
