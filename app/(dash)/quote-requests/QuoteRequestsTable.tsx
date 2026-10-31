import Link from "next/link";
import { todayEt, formatDayHeading, formatDateTimeEt } from "@/lib/dates";
import type { Database } from "@/lib/types/database";
import { QuoteRequestAssignedAgentSelect } from "./QuoteRequestAssignedAgentSelect";

type QuoteRequestRow = Database["public"]["Tables"]["quote_requests"]["Row"];

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

interface TeamMember {
  id: string;
  full_name: string | null;
  email: string;
}

interface Props {
  requests: QuoteRequestRow[];
  teamMembers: TeamMember[];
  propertyById: Map<string, { id: string; address: string }>;
  contactById: Map<string, { id: string; full_name: string | null; company_name: string | null }>;
}

/**
 * The active/completed grouped table shared by the main quote-requests page
 * and any page showing a filtered slice of the same rows (e.g. the
 * InstaHomeQuote funnel page) — kept as one component so the two never drift
 * apart on status labels, grouping, or row layout.
 */
export function QuoteRequestsTable({ requests, teamMembers, propertyById, contactById }: Props) {
  const activeRequests = requests.filter((r) => r.status === "new" || r.status === "processing" || r.status === "needs_review");
  const completedRequests = requests.filter((r) => r.status === "completed" || r.status === "failed");

  const completedByDay = new Map<string, QuoteRequestRow[]>();
  for (const r of completedRequests) {
    // processed_at is set the moment a request finishes (lib/quote-requests/fetch-pipeline.ts) —
    // the day it was actually completed, not the day it was first requested.
    const dayKey = todayEt(new Date(r.processed_at ?? r.created_at));
    const bucket = completedByDay.get(dayKey);
    if (bucket) bucket.push(r);
    else completedByDay.set(dayKey, [r]);
  }
  const completedDays = [...completedByDay.keys()].sort((a, b) => (a < b ? 1 : -1));

  function renderRow(r: QuoteRequestRow) {
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
            ) : r.requester_type === "consumer" ? (
              "Consumer (homeowner re-shop)"
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
        <td className="min-w-[10rem] px-4 py-3">
          <QuoteRequestAssignedAgentSelect requestId={r.id} assignedAgentId={r.assigned_agent_id} teamMembers={teamMembers} />
        </td>
        <td className="px-4 py-3 text-slate-500">{formatDateTimeEt(r.created_at)}</td>
      </tr>
    );
  }

  function requestsTable(rows: QuoteRequestRow[]) {
    return (
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-[#003049] text-xs uppercase text-white">
            <tr>
              <th className="px-4 py-3">Requester</th>
              <th className="px-4 py-3">Property</th>
              <th className="px-4 py-3">Wants</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Assigned to</th>
              <th className="px-4 py-3">Requested</th>
            </tr>
          </thead>
          <tbody>{rows.map(renderRow)}</tbody>
        </table>
      </div>
    );
  }

  return (
    <>
      {requests.length === 0 && <p className="text-sm text-slate-500">No requests yet.</p>}

      {activeRequests.length > 0 && <div className="mb-6">{requestsTable(activeRequests)}</div>}

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
                <div className="border-t border-slate-200">{requestsTable(rows)}</div>
              </details>
            );
          })}
        </div>
      )}
    </>
  );
}
