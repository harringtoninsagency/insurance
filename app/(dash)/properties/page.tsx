import Link from "next/link";
import { createServerSupabase } from "@/lib/supabase/server";
import { todayEt, formatDateOnly } from "@/lib/dates";
import { RunQuoteButton } from "../quote-requests/RunQuoteButton";
import { AssignedAgentSelect } from "./AssignedAgentSelect";

interface TeamMember {
  id: string;
  full_name: string | null;
  email: string;
}

interface PropertyRow {
  id: string;
  address: string;
  status: string;
  list_price: number | null;
  listing_agent_name: string | null;
  roof_year: number | null;
  date_quoted: string | null;
  assigned_agent_id: string | null;
  created_at: string;
}

// "2026-10-07" -> "Tuesday, October 7, 2026". Parsed as a plain date (no time
// component), so no time zone shift to worry about here. Same pattern as
// app/(dash)/properties/onehome/page.tsx's day grouping.
function formatDayHeading(dayKey: string): string {
  const [year, month, day] = dayKey.split("-").map(Number);
  const date = new Date(year!, month! - 1, day!);
  return new Intl.DateTimeFormat("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" }).format(date);
}

export default async function PropertiesPage({
  searchParams,
}: {
  searchParams: Promise<{ agent?: string; q?: string }>;
}) {
  // Set from this page's own filter form below — a specific profiles.id, or
  // "unassigned" for assigned_agent_id is null. Same query-param shape as
  // app/(dash)/quote-requests/page.tsx's agent filter.
  const { agent: agentFilter, q: query } = await searchParams;

  const supabase = await createServerSupabase();
  // Four independent queries — parallelized rather than four sequential
  // round trips, since each one pays the same Vercel-function-to-Supabase
  // network latency regardless of how small it is.
  const [{ data: propertiesData, error }, { data: teamMembers }, { data: queued }, { data: enrichmentRows }] = await Promise.all([
    supabase
      .from("properties")
      .select("id, address, status, list_price, listing_agent_name, roof_year, date_quoted, assigned_agent_id, created_at")
      .order("created_at", { ascending: false }),
    supabase.from("profiles").select("id, full_name, email").eq("active", true).order("full_name"),
    // Properties with a quote already queued show "Queued" instead of a button.
    supabase.from("quote_requests").select("property_id").in("status", ["new", "processing"]).not("property_id", "is", null),
    // Enrichments keeps one audit row per enrichment run, newest first here —
    // keep only the first (latest) row seen per property.
    supabase.from("enrichments").select("property_id, flood_zone, dist_to_coast_miles").order("fetched_at", { ascending: false }),
  ]);
  let properties = propertiesData as PropertyRow[] | null;

  if (agentFilter) {
    properties = (properties ?? []).filter((p) => (agentFilter === "unassigned" ? !p.assigned_agent_id : p.assigned_agent_id === agentFilter));
  }
  if (query?.trim()) {
    const needle = query.trim().toLowerCase();
    properties = (properties ?? []).filter((p) => p.address.toLowerCase().includes(needle));
  }

  const agentFilterName = agentFilter === "unassigned" ? "Unassigned" : (teamMembers ?? []).find((m) => m.id === agentFilter)?.full_name;
  const queuedIds = new Set((queued ?? []).map((r) => r.property_id as string));
  const latestEnrichmentByProperty = new Map<string, { flood_zone: string | null; dist_to_coast_miles: number | null }>();
  for (const row of enrichmentRows ?? []) {
    if (!latestEnrichmentByProperty.has(row.property_id)) {
      latestEnrichmentByProperty.set(row.property_id, { flood_zone: row.flood_zone, dist_to_coast_miles: row.dist_to_coast_miles });
    }
  }

  const byDay = new Map<string, PropertyRow[]>();
  for (const p of properties ?? []) {
    const dayKey = todayEt(new Date(p.created_at));
    const bucket = byDay.get(dayKey);
    if (bucket) bucket.push(p);
    else byDay.set(dayKey, [p]);
  }
  const days = [...byDay.keys()].sort((a, b) => (a < b ? 1 : -1));

  function renderTable(rows: PropertyRow[], teamMembers: TeamMember[]) {
    return (
      <div className="overflow-x-auto">
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
            {rows.map((p) => {
              const enrichment = latestEnrichmentByProperty.get(p.id);
              return (
                <tr key={p.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-3">
                    <AssignedAgentSelect
                      key={`${p.id}:${p.assigned_agent_id ?? ""}`}
                      propertyId={p.id}
                      assignedAgentId={p.assigned_agent_id}
                      teamMembers={teamMembers}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/properties/${p.id}`} className="font-medium text-[#003049] hover:underline">
                      {p.address}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{p.listing_agent_name ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{p.list_price ? `$${Number(p.list_price).toLocaleString()}` : "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{p.roof_year ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{enrichment?.flood_zone ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {enrichment?.dist_to_coast_miles != null ? `${enrichment.dist_to_coast_miles} mi` : "—"}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{formatDateOnly(p.date_quoted)}</td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-[#8291AC]/15 px-2 py-1 text-xs font-medium text-[#003049]">{p.status}</span>
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
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-[#003049]">Properties</h1>
          <div className="mb-6 mt-2 h-[3px] w-16 bg-[#F0FF00]" />
        </div>
        <Link href="/quote-requests/new" className="shrink-0 rounded-full bg-[#F0FF00] px-4 py-2 text-sm font-bold text-[#003049] transition-colors hover:brightness-95">
          Run a quote now
        </Link>
      </div>

      <form action="/properties" method="GET" className="mb-4 flex flex-wrap items-center gap-2">
        <input
          type="search"
          name="q"
          defaultValue={query ?? ""}
          placeholder="Search by address…"
          className="w-64 rounded border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#003049] focus:ring-2 focus:ring-[#003049]/20"
        />
        <select
          name="agent"
          defaultValue={agentFilter ?? ""}
          className="rounded border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#003049] focus:ring-2 focus:ring-[#003049]/20"
        >
          <option value="">All agents</option>
          <option value="unassigned">Unassigned</option>
          {(teamMembers ?? []).map((m) => (
            <option key={m.id} value={m.id}>
              {m.full_name ?? m.email}
            </option>
          ))}
        </select>
        <button type="submit" className="rounded-full bg-[#003049] px-4 py-2 text-sm font-medium text-white transition-colors hover:brightness-110">
          Filter
        </button>
        {(query || agentFilter) && (
          <Link href="/properties" className="text-sm text-[#003049] hover:underline">
            Clear
          </Link>
        )}
      </form>

      {agentFilter && (
        <p className="mb-2 text-sm text-slate-600">
          Showing only properties assigned to <span className="font-medium text-[#003049]">{agentFilterName ?? "that agent"}</span>.
        </p>
      )}

      {error && (
        <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">
          {error.message}
        </p>
      )}

      {!error && days.length === 0 && (agentFilter || query) && (
        <p className="text-sm text-slate-500">No properties match{query ? ` "${query}"` : ""}{agentFilter ? ` for ${agentFilterName ?? "that agent"}` : ""}.</p>
      )}

      {!error && days.length === 0 && !agentFilter && !query && (
        <p className="text-sm text-slate-500">
          No properties yet. Listing ingest lands in Phase 3 — for now, rows
          can be added directly in Supabase Studio to test this screen.
        </p>
      )}

      {days.length > 0 && (
        <div className="space-y-3">
          {days.map((dayKey, i) => {
            const rows = byDay.get(dayKey)!;
            return (
              <details key={dayKey} className="overflow-hidden rounded-lg border border-slate-200 bg-white" open={i === 0}>
                <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium text-[#003049]">
                  {formatDayHeading(dayKey)} <span className="text-slate-400">({rows.length})</span>
                </summary>
                <div className="border-t border-slate-200">{renderTable(rows, teamMembers ?? [])}</div>
              </details>
            );
          })}
        </div>
      )}
    </div>
  );
}
