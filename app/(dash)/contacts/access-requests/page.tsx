import { createServerSupabase } from "@/lib/supabase/server";
import { BackLink } from "@/app/BackLink";
import { formatDateOnlyEt } from "@/lib/dates";
import { ReviewButtons } from "./ReviewButtons";

const TYPE_LABEL = { realtor: "Realtor", mortgage_broker: "Mortgage broker", roofing_company: "Roofing company" } as const;

export default async function AccessRequestsPage() {
  const supabase = await createServerSupabase();

  const [{ data: pending }, { data: reviewed }, { data: teamMembers }] = await Promise.all([
    supabase.from("partner_access_requests").select("*").eq("status", "pending").order("created_at", { ascending: true }),
    supabase.from("partner_access_requests").select("*").neq("status", "pending").order("reviewed_at", { ascending: false }).limit(25),
    supabase.from("profiles").select("id, full_name, email"),
  ]);

  const reviewerName = (id: string | null) => {
    if (!id) return "—";
    const m = teamMembers?.find((t) => t.id === id);
    return m?.full_name ?? m?.email ?? "—";
  };

  return (
    <div className="max-w-4xl space-y-8">
      <div>
        <BackLink href="/contacts" label="Referral Partners" />
        <h1 className="mt-2 text-xl font-semibold text-[#003049]">Partner access requests</h1>
        <div className="mb-2 mt-2 h-[3px] w-16 bg-[#F0FF00]" />
        <p className="text-sm text-slate-500">
          The gated front door for the partner app — verify the license number against{" "}
          <a href="https://www.myfloridalicense.com/wl11.asp?mode=0&SID=" target="_blank" rel="noreferrer" className="text-[#003049] underline">
            DBPR
          </a>{" "}
          (realtors, roofing contractors) or{" "}
          <a href="https://www.nmlsconsumeraccess.org/" target="_blank" rel="noreferrer" className="text-[#003049] underline">
            NMLS Consumer Access
          </a>{" "}
          (mortgage brokers) before approving. Approving sends them the same portal invite as inviting a contact by hand.
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="font-medium text-[#003049]">Pending ({pending?.length ?? 0})</h2>
        {!pending?.length ? (
          <p className="text-sm text-slate-500">Nothing waiting on review.</p>
        ) : (
          <ul className="space-y-3">
            {pending.map((r) => (
              <li key={r.id} className="rounded-lg border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-1 text-sm">
                    <div className="font-medium text-[#003049]">
                      {r.full_name} <span className="text-slate-400">· {TYPE_LABEL[r.contact_type]}</span>
                    </div>
                    {r.company_name && <div className="text-slate-600">{r.company_name}</div>}
                    <div className="text-slate-600">
                      License: <span className="font-mono">{r.license_number}</span>
                    </div>
                    <div className="text-slate-600">{r.email}</div>
                    {r.cell_phone && <div className="text-slate-600">{r.cell_phone}</div>}
                    {r.buyers_per_month && <div className="text-xs text-slate-400">~{r.buyers_per_month} buyers/month</div>}
                    <div className="text-xs text-slate-400">Submitted {formatDateOnlyEt(r.created_at)}</div>
                  </div>
                  <ReviewButtons requestId={r.id} fullName={r.full_name} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="font-medium text-[#003049]">Recently reviewed</h2>
        {!reviewed?.length ? (
          <p className="text-sm text-slate-500">Nothing reviewed yet.</p>
        ) : (
          <ul className="space-y-2">
            {reviewed.map((r) => (
              <li key={r.id} className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium text-slate-800">
                    {r.full_name} <span className="text-slate-400">· {TYPE_LABEL[r.contact_type]}</span>
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${r.status === "approved" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}
                  >
                    {r.status}
                  </span>
                </div>
                <div className="text-xs text-slate-500">
                  {r.reviewed_at ? formatDateOnlyEt(r.reviewed_at) : ""} by {reviewerName(r.reviewed_by)}
                  {r.status_detail ? ` — ${r.status_detail}` : ""}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
