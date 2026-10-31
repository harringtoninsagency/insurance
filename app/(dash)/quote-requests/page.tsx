import Link from "next/link";
import { createServerSupabase } from "@/lib/supabase/server";
import { QuoteRequestsTable } from "./QuoteRequestsTable";

export default async function QuoteRequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ agent?: string }>;
}) {
  // Linked from the Home page's per-agent assignment summary: a specific
  // profiles.id to filter to, or "unassigned" for assigned_agent_id is null.
  const { agent: agentFilter } = await searchParams;

  const supabase = await createServerSupabase();
  const [{ data: allRequests, error }, { data: teamMembers }] = await Promise.all([
    supabase.from("quote_requests").select("*").order("created_at", { ascending: false }).limit(200),
    supabase.from("profiles").select("id, full_name, email").eq("active", true).order("full_name"),
  ]);
  const requests = agentFilter
    ? (allRequests ?? []).filter((r) => (agentFilter === "unassigned" ? !r.assigned_agent_id : r.assigned_agent_id === agentFilter))
    : allRequests;
  const agentFilterName =
    agentFilter === "unassigned" ? "Unassigned" : (teamMembers ?? []).find((m) => m.id === agentFilter)?.full_name;

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
        <Link href="/quote-requests/new" className="shrink-0 rounded-full bg-[#F0FF00] px-4 py-2 text-sm font-bold text-[#003049] transition-colors hover:brightness-95">
          Run a quote now
        </Link>
      </div>
      {agentFilter && (
        <p className="mb-2 text-sm text-slate-600">
          Showing only requests assigned to <span className="font-medium text-[#003049]">{agentFilterName ?? "that agent"}</span> —{" "}
          <Link href="/quote-requests" className="text-[#003049] hover:underline">
            show all
          </Link>
        </p>
      )}
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
      {!error && (
        <QuoteRequestsTable requests={requests ?? []} teamMembers={teamMembers ?? []} propertyById={propertyById} contactById={contactById} />
      )}
    </div>
  );
}
