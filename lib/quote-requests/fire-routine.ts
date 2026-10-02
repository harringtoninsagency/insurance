import { createServiceSupabase } from "@/lib/supabase/server";

const FIRE_THROTTLE_MS = 3 * 60 * 1000;
const FIRE_TIMEOUT_MS = 8000;

/**
 * Starts the cloud quote routine right now instead of waiting for the hourly run
 * (claude.ai routine API trigger — experimental). Never throws: the request is
 * already queued, so if this fails the hourly run still picks it up.
 *
 * Needs QUOTE_ROUTINE_ID (trig_...) and QUOTE_ROUTINE_TOKEN (generated on the
 * routine's page at claude.ai/code/routines; scoped to firing that one routine).
 * Without them this is a no-op and the hourly schedule does all the work.
 */
export async function fireQuoteRoutine(requestId: string): Promise<{ started: boolean; reason?: string }> {
  const routineId = process.env.QUOTE_ROUTINE_ID;
  const token = process.env.QUOTE_ROUTINE_TOKEN;
  if (!routineId || !token) return { started: false, reason: "not configured" };

  try {
    const supabase = createServiceSupabase();

    // A run fired moments ago is already on its way and re-checks the queue before it ends.
    const since = new Date(Date.now() - FIRE_THROTTLE_MS).toISOString();
    const { data: recent } = await supabase.from("quote_requests").select("id").gt("routine_fired_at", since).limit(1);
    if (recent?.[0]) return { started: true, reason: "a run was just started" };

    const res = await fetch(`https://api.anthropic.com/v1/claude_code/routines/${encodeURIComponent(routineId)}/fire`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "anthropic-version": "2023-06-01" },
      signal: AbortSignal.timeout(FIRE_TIMEOUT_MS),
    });
    if (!res.ok) return { started: false, reason: `routine API returned ${res.status}` };

    await supabase.from("quote_requests").update({ routine_fired_at: new Date().toISOString() }).eq("id", requestId);
    return { started: true };
  } catch (err) {
    return { started: false, reason: err instanceof Error ? err.message : "fire failed" };
  }
}
