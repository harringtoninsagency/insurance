import Link from "next/link";
import { createServerSupabase } from "@/lib/supabase/server";
import { formatDateOnly } from "@/lib/dates";
import { RunQuoteButton } from "../quote-requests/RunQuoteButton";
import { AssignedAgentSelect } from "./AssignedAgentSelect";

export default async function PropertiesPage() {
  const supabase = await createServerSupabase();
  const { data: properties, error } = await supabase
    .from("properties")
    .select("id, address, status, list_price, listing_agent_name, roof_year, date_quoted, assigned_agent_id, created_at")
    .order("created_at", { ascending: false });

  const { data: teamMembers } = await supabase.from("profiles").select("id, full_name, email").eq("active", true).order("full_name");

  // Properties with a quote already queued show "Queued" instead of a button.
  const { data: queued } = await supabase.from("quote_requests").select("property_id").in("status", ["new", "processing"]).not("property_id", "is", null);
  const queuedIds = new Set((queued ?? []).map((r) => r.property_id as string));

  // Enrichments keeps one audit row per enrichment run, newest first here —
  // keep only the first (latest) row seen per property.
  const { data: enrichmentRows } = await supabase
    .from("enrichments")
    .select("property_id, flood_zone, dist_to_coast_miles")
    .order("fetched_at", { ascending: false });
  const latestEnrichmentByProperty = new Map<string, { flood_zone: string | null; dist_to_coast_miles: number | null }>();
  for (const row of enrichmentRows ?? []) {
    if (!latestEnrichmentByProperty.has(row.property_id)) {
      latestEnrichmentByProperty.set(row.property_id, { flood_zone: row.flood_zone, dist_to_coast_miles: row.dist_to_coast_miles });
    }
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-[#003049]">Properties</h1>
          <div className="mb-6 mt-2 h-[3px] w-16 bg-[#F0FF00]" />
        </div>
        <Link href="/quote-requests/new" className="shrink-0 rounded bg-[#003049] px-4 py-2 text-sm font-semibold text-white">
          Run a quote now
        </Link>
      </div>

      {error && (
        <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">
          {error.message}
        </p>
      )}

      {!error && properties?.length === 0 && (
        <p className="text-sm text-slate-500">
          No properties yet. Listing ingest lands in Phase 3 — for now, rows
          can be added directly in Supabase Studio to test this screen.
        </p>
      )}

      {!!properties?.length && (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-[#003049] text-xs uppercase text-white">
              <tr>
                <th className="px-4 py-3">Assigned Agent</th>
                <th className="px-4 py-3">Address</th>
                <th className="px-4 py-3">Listing agent</th>
                <th className="px-4 py-3">List price</th>
                <th className="px-4 py-3">Roof year</th>
                <th className="px-4 py-3">Flood zone</th>
                <th className="px-4 py-3">Dist. to coast</th>
                <th className="px-4 py-3">Date quoted</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Quote</th>
              </tr>
            </thead>
            <tbody>
              {properties.map((p) => {
                const enrichment = latestEnrichmentByProperty.get(p.id);
                return (
                <tr key={p.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-3">
                    <AssignedAgentSelect propertyId={p.id} assignedAgentId={p.assigned_agent_id} teamMembers={teamMembers ?? []} />
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/properties/${p.id}`}
                      className="font-medium text-[#003049] hover:underline"
                    >
                      {p.address}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {p.listing_agent_name ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {p.list_price ? `$${Number(p.list_price).toLocaleString()}` : "—"}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {p.roof_year ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {enrichment?.flood_zone ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {enrichment?.dist_to_coast_miles != null ? `${enrichment.dist_to_coast_miles} mi` : "—"}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{formatDateOnly(p.date_quoted)}</td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-[#8291AC]/15 px-2 py-1 text-xs font-medium text-[#003049]">
                      {p.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {queuedIds.has(p.id) ? (
                      <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800">Queued</span>
                    ) : (
                      <RunQuoteButton propertyId={p.id} compact label="Run quote" />
                    )}
                  </td>
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
