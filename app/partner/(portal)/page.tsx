import { createServerSupabase } from "@/lib/supabase/server";
import { NewRequestForm } from "./NewRequestForm";

const STATUS_LABEL: Record<string, { label: string; className: string }> = {
  new: { label: "Received", className: "bg-slate-100 text-slate-600" },
  processing: { label: "In progress", className: "bg-amber-100 text-amber-800" },
  completed: { label: "Ready", className: "bg-green-100 text-green-700" },
  needs_review: { label: "Needs a producer's help", className: "bg-amber-100 text-amber-800" },
  failed: { label: "Couldn't be completed", className: "bg-red-100 text-red-700" },
};

const KIND_LABEL: Record<string, string> = {
  quote_summary: "Quote summary",
  listing_snapshot: "Listing snapshot",
  both: "Quote summary + listing snapshot",
};

export default async function PartnerPortalPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // RLS (quote_requests: partner reads own) already limits this to the
  // signed-in partner's own submissions — no extra filter needed here.
  const { data: requests, error } = await supabase
    .from("quote_requests")
    .select("*")
    .order("created_at", { ascending: false });

  const propertyIds = [...new Set((requests ?? []).map((r) => r.property_id).filter((id): id is string => !!id))];
  const [{ data: properties }, { data: proposals }] = await Promise.all([
    propertyIds.length ? supabase.from("properties").select("id, address").in("id", propertyIds) : { data: [] },
    propertyIds.length ? supabase.from("proposals").select("id, property_id, kind, version, pdf_path").in("property_id", propertyIds) : { data: [] },
  ]);
  const propertyById = new Map((properties ?? []).map((p) => [p.id, p]));
  type ProposalRow = NonNullable<typeof proposals>[number];
  const proposalsByProperty = new Map<string, ProposalRow[]>();
  for (const p of proposals ?? []) {
    const list = proposalsByProperty.get(p.property_id) ?? [];
    list.push(p);
    proposalsByProperty.set(p.property_id, list);
  }

  const downloadUrls = new Map<string, string>();
  const withPath = (proposals ?? []).filter((p) => p.pdf_path);
  if (withPath.length) {
    const signed = await Promise.all(withPath.map((p) => supabase.storage.from("proposals").createSignedUrl(p.pdf_path!, 3600)));
    signed.forEach(({ data }, i) => {
      if (data?.signedUrl) downloadUrls.set(withPath[i]!.id, data.signedUrl);
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-[#003049]">My quote requests</h1>
        <div className="mb-2 mt-2 h-[3px] w-16 bg-[#F0FF00]" />
        <p className="text-sm text-slate-500">
          Submit a property below and we&apos;ll get back to you with results — usually within an hour, sometimes
          sooner.
        </p>
      </div>

      <NewRequestForm defaultEmail={user?.email ?? ""} />

      <section className="space-y-2">
        {error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error.message}</p>}
        {!error && requests?.length === 0 && <p className="text-sm text-slate-500">No requests yet — submit one above.</p>}
        {(requests ?? []).map((r) => {
          const status = STATUS_LABEL[r.status] ?? STATUS_LABEL.new!;
          const property = r.property_id ? propertyById.get(r.property_id) : undefined;
          const requestProposals = r.property_id ? proposalsByProperty.get(r.property_id) ?? [] : [];
          return (
            <div key={r.id} className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-[#003049]">{property?.address ?? r.address_line}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${status.className}`}>{status.label}</span>
              </div>
              <p className="mt-1 text-slate-600">
                {KIND_LABEL[r.request_kind] ?? r.request_kind} · requested {new Date(r.created_at).toLocaleDateString()}
              </p>
              {r.status_detail && <p className="mt-1 text-xs text-slate-500">{r.status_detail}</p>}
              {!!requestProposals.length && (
                <div className="mt-2 flex flex-wrap gap-3">
                  {requestProposals.map((p) => (
                    <a
                      key={p.id}
                      href={downloadUrls.get(p.id)}
                      className="rounded border border-[#003049] px-3 py-1 text-xs font-medium text-[#003049] hover:bg-[#003049]/5"
                    >
                      Download {p.kind.replace(/_/g, " ")} (v{p.version})
                    </a>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </section>
    </div>
  );
}
