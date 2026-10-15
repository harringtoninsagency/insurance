import Link from "next/link";
import { createServerSupabase } from "@/lib/supabase/server";

const ACTIVE_STATUSES = ["new", "processing", "needs_review"] as const;

interface AgentCount {
  id: string;
  label: string;
  active: number;
  total: number;
}

export default async function HomePage() {
  const supabase = await createServerSupabase();
  const [{ data: teamMembers }, { data: requests, error }] = await Promise.all([
    supabase.from("profiles").select("id, full_name, email, role").eq("active", true).order("full_name"),
    supabase.from("quote_requests").select("id, status, assigned_agent_id"),
  ]);

  const byAgent = new Map<string, { active: number; total: number }>();
  let unassignedActive = 0;
  let unassignedTotal = 0;
  for (const r of requests ?? []) {
    const isActive = (ACTIVE_STATUSES as readonly string[]).includes(r.status);
    if (!r.assigned_agent_id) {
      unassignedTotal += 1;
      if (isActive) unassignedActive += 1;
      continue;
    }
    const bucket = byAgent.get(r.assigned_agent_id) ?? { active: 0, total: 0 };
    bucket.total += 1;
    if (isActive) bucket.active += 1;
    byAgent.set(r.assigned_agent_id, bucket);
  }

  const agentCounts: AgentCount[] = (teamMembers ?? []).map((m) => {
    const counts = byAgent.get(m.id) ?? { active: 0, total: 0 };
    return { id: m.id, label: m.full_name ?? m.email, ...counts };
  });
  // Busiest agents first, so this reads as a workload snapshot rather than an alphabetical roster.
  agentCounts.sort((a, b) => b.active - a.active || b.total - a.total);

  const totalActive = agentCounts.reduce((sum, a) => sum + a.active, 0) + unassignedActive;

  return (
    <div>
      <div>
        <h1 className="text-xl font-semibold text-[#003049]">Home</h1>
        <div className="mb-2 mt-2 h-[3px] w-16 bg-[#F0FF00]" />
        <p className="mb-6 text-sm text-slate-500">
          Quote requests assigned to each agent — assign one from its row on the{" "}
          <Link href="/quote-requests" className="text-[#003049] hover:underline">
            Quote requests
          </Link>{" "}
          page.
        </p>
      </div>

      {error && <p className="mb-4 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error.message}</p>}

      {totalActive > 0 && (
        <p className="mb-4 rounded bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {totalActive} request{totalActive === 1 ? " is" : "s are"} still active agency-wide.
        </p>
      )}

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-[#003049] text-xs uppercase text-white">
            <tr>
              <th className="px-4 py-3">Agent</th>
              <th className="px-4 py-3">Active</th>
              <th className="px-4 py-3">Total assigned</th>
            </tr>
          </thead>
          <tbody>
            {agentCounts.map((a) => (
              <tr key={a.id} className="border-b border-slate-100 last:border-0">
                <td className="px-4 py-3 font-medium text-[#003049]">{a.label}</td>
                <td className="px-4 py-3">
                  {a.active > 0 ? (
                    <Link href={`/quote-requests?agent=${a.id}`} className="font-medium text-amber-700 hover:underline">
                      {a.active}
                    </Link>
                  ) : (
                    <span className="text-slate-400">0</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {a.total > 0 ? (
                    <Link href={`/quote-requests?agent=${a.id}`} className="text-[#003049] hover:underline">
                      {a.total}
                    </Link>
                  ) : (
                    <span className="text-slate-400">0</span>
                  )}
                </td>
              </tr>
            ))}
            <tr className="border-t-2 border-slate-200 bg-slate-50">
              <td className="px-4 py-3 font-medium text-slate-600">Unassigned</td>
              <td className="px-4 py-3">
                {unassignedActive > 0 ? (
                  <Link href="/quote-requests?agent=unassigned" className="font-medium text-amber-700 hover:underline">
                    {unassignedActive}
                  </Link>
                ) : (
                  <span className="text-slate-400">0</span>
                )}
              </td>
              <td className="px-4 py-3">
                {unassignedTotal > 0 ? (
                  <Link href="/quote-requests?agent=unassigned" className="text-[#003049] hover:underline">
                    {unassignedTotal}
                  </Link>
                ) : (
                  <span className="text-slate-400">0</span>
                )}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
