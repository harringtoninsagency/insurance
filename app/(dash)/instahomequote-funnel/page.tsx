import { createServerSupabase } from "@/lib/supabase/server";
import { QuoteRequestsTable } from "../quote-requests/QuoteRequestsTable";

// Same quote_requests table everyone else's requests land in — filtered to
// lead_source = 'instahomequote', set server-side by app/quote/actions.ts
// from the actual Host header the submission came in on (see
// app/instahomequote/page.tsx, the public landing page this reports on).
export default async function InstaHomeQuoteFunnelPage() {
  const supabase = await createServerSupabase();
  const [{ data: requests, error }, { data: teamMembers }] = await Promise.all([
    supabase.from("quote_requests").select("*").eq("lead_source", "instahomequote").order("created_at", { ascending: false }).limit(200),
    supabase.from("profiles").select("id, full_name, email").eq("active", true).order("full_name"),
  ]);

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
      <div>
        <h1 className="text-xl font-semibold text-[#003049]">InstaHomeQuote Funnel</h1>
        <div className="mb-2 mt-2 h-[3px] w-16 bg-[#F0FF00]" />
      </div>
      <p className="mb-6 text-sm text-slate-500">
        Leads submitted through the InstaHomeQuote marketing domain (www.instahomequote.com), routed through the exact
        same Clear to Close quoting pipeline as every other request — just tracked separately here so you can see what
        that funnel is actually producing.
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
