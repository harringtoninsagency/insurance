import { createServerSupabase } from "@/lib/supabase/server";
import { todayEt, formatDayHeading } from "@/lib/dates";
import type { Database } from "@/lib/types/database";
import { NewRequestForm } from "./NewRequestForm";

type QuoteRequestRow = Database["public"]["Tables"]["quote_requests"]["Row"];

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

// fire-routine.ts writes the raw failure reason (e.g. "routine API returned
// 401") into status_detail so the team can diagnose it from the internal
// quote-requests list — that detail isn't meant for a partner's eyes.
function partnerFacingDetail(detail: string | null): string | null {
  if (detail?.startsWith("Queued by a team member")) return "We're finishing this up now — results are on the way.";
  return detail;
}

export default async function PartnerPortalPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // An admin has no partner_accounts row (see ./layout.tsx), so
  // current_partner_contact_id() never matches for them — what actually
  // returns every agency's requests below is the "quote_requests: agency
  // scoped" RLS policy instead, the same one the internal dashboard uses.
  const { data: profile } = await supabase.from("profiles").select("role, active").eq("id", user?.id ?? "").maybeSingle();
  const isAdminView = profile?.role === "admin" && profile.active;

  // RLS (quote_requests: partner reads own, or quote_requests: agency
  // scoped for an admin) already limits this to the right rows — no extra
  // filter needed here.
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

  // Same split as the internal quote-requests page: active requests (still
  // need something) always shown flat, front and center; completed/failed
  // ones grouped into collapsible daily batches so the list doesn't just
  // grow forever — most useful here in admin view, where it's every
  // partner's requests at once.
  const activeRequests = (requests ?? []).filter((r) => r.status === "new" || r.status === "processing" || r.status === "needs_review");
  const completedRequests = (requests ?? []).filter((r) => r.status === "completed" || r.status === "failed");

  const completedByDay = new Map<string, QuoteRequestRow[]>();
  for (const r of completedRequests) {
    const dayKey = todayEt(new Date(r.processed_at ?? r.created_at));
    const bucket = completedByDay.get(dayKey);
    if (bucket) bucket.push(r);
    else completedByDay.set(dayKey, [r]);
  }
  const completedDays = [...completedByDay.keys()].sort((a, b) => (a < b ? 1 : -1));

  function renderCard(r: QuoteRequestRow) {
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
          {isAdminView && <span className="font-medium">{r.requester_name}</span>}
          {isAdminView && " · "}
          {KIND_LABEL[r.request_kind] ?? r.request_kind} · requested {new Date(r.created_at).toLocaleDateString()}
        </p>
        {partnerFacingDetail(r.status_detail) && <p className="mt-1 text-xs text-slate-500">{partnerFacingDetail(r.status_detail)}</p>}
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
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-[#003049]">{isAdminView ? "All partner quote requests" : "My quote requests"}</h1>
        <div className="mb-2 mt-2 h-[3px] w-16 bg-[#F0FF00]" />
        {isAdminView ? (
          <p className="text-sm text-slate-500">Every partner&apos;s submissions, across the whole agency.</p>
        ) : (
          <p className="text-sm text-slate-500">
            Submit a property below and we&apos;ll get back to you with results — usually within an hour, sometimes
            sooner.
          </p>
        )}
      </div>

      {/* Submission ties to the signer's own partner_accounts row (see
          submitPartnerQuoteRequestAction), which an admin doesn't have —
          admin view is read-only here; use the internal quote-requests page
          to submit on a partner's behalf instead. */}
      {!isAdminView && <NewRequestForm defaultEmail={user?.email ?? ""} />}

      {error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error.message}</p>}
      {!error && requests?.length === 0 && <p className="text-sm text-slate-500">No requests yet{!isAdminView && " — submit one above"}.</p>}

      {activeRequests.length > 0 && <section className="space-y-2">{activeRequests.map(renderCard)}</section>}

      {completedDays.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold uppercase text-[#003049]">Completed</h2>
          {completedDays.map((dayKey, i) => {
            const rows = completedByDay.get(dayKey)!;
            return (
              <details key={dayKey} className="rounded-lg border border-slate-200 bg-white" open={i === 0}>
                <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium text-[#003049]">
                  {formatDayHeading(dayKey)} <span className="text-slate-400">({rows.length})</span>
                </summary>
                <div className="space-y-2 border-t border-slate-200 p-3">{rows.map(renderCard)}</div>
              </details>
            );
          })}
        </div>
      )}
    </div>
  );
}
