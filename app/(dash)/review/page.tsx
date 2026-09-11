import { createServerSupabase } from "@/lib/supabase/server";
import { ReviewActions } from "./ReviewActions";

export default async function ReviewPage() {
  const supabase = await createServerSupabase();
  const { data: pending, error } = await supabase
    .from("outreach")
    .select("id, recipient, status, created_at, proposal_id")
    .eq("status", "pending_review")
    .order("created_at", { ascending: true });

  return (
    <div>
      <h1 className="text-xl font-semibold text-[#003049]">Outreach review</h1>
      <div className="mb-2 mt-2 h-[3px] w-16 bg-[#F0FF00]" />
      <p className="mb-6 text-sm text-slate-500">
        Generated indications land here first. Nothing sends until a producer
        approves it — see the outreach guardrails in the implementation plan.
      </p>

      {error && (
        <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">
          {error.message}
        </p>
      )}

      {!error && pending?.length === 0 && (
        <p className="text-sm text-slate-500">
          Nothing pending review. Queue one from a property's Proposals section.
        </p>
      )}

      {!!pending?.length && (
        <ul className="space-y-2">
          {pending.map((item) => (
            <li
              key={item.id}
              className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm"
            >
              <div>
                <p className="font-medium">{item.recipient}</p>
                <p className="text-slate-500">
                  Queued {new Date(item.created_at).toLocaleString()}
                </p>
              </div>
              <ReviewActions outreachId={item.id} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
