import Link from "next/link";
import { createServerSupabase } from "@/lib/supabase/server";

const STATUS_LABEL: Record<string, { label: string; className: string }> = {
  new: { label: "New", className: "bg-slate-100 text-slate-600" },
  processing: { label: "Ready to quote", className: "bg-amber-100 text-amber-800" },
  completed: { label: "Completed", className: "bg-green-100 text-green-700" },
  needs_review: { label: "Needs review", className: "bg-red-100 text-red-700" },
  failed: { label: "Failed", className: "bg-red-100 text-red-700" },
};

const KIND_LABEL: Record<string, string> = {
  quote_summary: "Quote summary",
  listing_snapshot: "Listing snapshot",
  both: "Quote summary + listing snapshot",
};

export default async function QuoteRequestsPage() {
  const supabase = await createServerSupabase();
  const { data: requests, error } = await supabase.from("quote_requests").select("*").order("created_at", { ascending: false }).limit(200);

  const propertyIds = [...new Set((requests ?? []).map((r) => r.property_id).filter((id): id is string => !!id))];
  const contactIds = [...new Set((requests ?? []).map((r) => r.contact_id).filter((id): id is string => !!id))];
  const [{ data: properties }, { data: contacts }] = await Promise.all([
    propertyIds.length ? supabase.from("properties").select("id, address").in("id", propertyIds) : { data: [] },
    contactIds.length ? supabase.from("industry_contacts").select("id, full_name, company_name").in("id", contactIds) : { data: [] },
  ]);
  const propertyById = new Map((properties ?? []).map((p) => [p.id, p]));
  const contactById = new Map((contacts ?? []).map((c) => [c.id, c]));

  const pendingCount = (requests ?? []).filter((r) => r.status === "processing").length;
  const needsReviewCount = (requests ?? []).filter((r) => r.status === "needs_review").length;

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-[#003049]">Quote requests</h1>
          <div className="mb-2 mt-2 h-[3px] w-16 bg-[#F0FF00]" />
        </div>
        <Link href="/quote-requests/new" className="shrink-0 rounded bg-[#003049] px-4 py-2 text-sm font-semibold text-white">
          Run a quote now
        </Link>
      </div>
      <p className="mb-6 text-sm text-slate-500">
        Requests from the public quote-request page, the partner portal, and your team (Run a quote now). Property matching happens
        automatically; the carrier quote and PDFs still need an agent session (ask Claude to process the queue, or
        wait for the scheduled routine) — nothing here can trigger that from the browser.
      </p>

      {pendingCount > 0 && (
        <p className="mb-4 rounded bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {pendingCount} request{pendingCount === 1 ? " is" : "s are"} matched and waiting for a carrier quote.
        </p>
      )}
      {needsReviewCount > 0 && (
        <p className="mb-4 rounded bg-red-50 px-3 py-2 text-sm text-red-800">
          {needsReviewCount} request{needsReviewCount === 1 ? "" : "s"} couldn&apos;t be matched automatically and need{needsReviewCount === 1 ? "s" : ""} a producer to fill in property details.
        </p>
      )}

      {error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error.message}</p>}
      {!error && requests?.length === 0 && <p className="text-sm text-slate-500">No requests yet.</p>}

      {!!requests?.length && (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-[#003049] text-xs uppercase text-white">
              <tr>
                <th className="px-4 py-3">Requester</th>
                <th className="px-4 py-3">Property</th>
                <th className="px-4 py-3">Wants</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Requested</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => {
                const status = STATUS_LABEL[r.status] ?? STATUS_LABEL.new!;
                const property = r.property_id ? propertyById.get(r.property_id) : undefined;
                const contact = r.contact_id ? contactById.get(r.contact_id) : undefined;
                return (
                  <tr key={r.id} className="border-b border-slate-100 align-top last:border-0">
                    <td className="px-4 py-3">
                      <div className="font-medium text-[#003049]">{r.requester_name}</div>
                      <div className="text-xs text-slate-500">
                        {contact ? (
                          <>
                            Partner —{" "}
                            <Link href={`/contacts/${contact.id}`} className="hover:underline">
                              {contact.company_name ?? "directory contact"}
                            </Link>
                          </>
                        ) : r.requester_type === "internal" ? (
                          "Team"
                        ) : (
                          "Public"
                        )}{" "}
                        · {r.requester_email}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {property && r.property_id ? (
                        <Link href={`/properties/${r.property_id}`} className="text-[#003049] hover:underline">
                          {property.address}
                        </Link>
                      ) : (
                        `${r.address_line}, ${r.city}`
                      )}
                      {r.status_detail && <div className="mt-1 text-xs text-slate-400">{r.status_detail}</div>}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{KIND_LABEL[r.request_kind] ?? r.request_kind}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${status.className}`}>{status.label}</span>
                    </td>
                    <td className="px-4 py-3 text-slate-500">{new Date(r.created_at).toLocaleString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
