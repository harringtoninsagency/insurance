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
  const result = await tryFire(requestId);
  if (!result.started) {
    // Surface why on the request itself (property page / quote requests list) so a failed fire is diagnosable.
    await createServiceSupabase()
      .from("quote_requests")
      .update({ status_detail: `Queued by a team member — couldn't start the quote run now (${result.reason}); the hourly run will pick it up.` })
      .eq("id", requestId)
      .eq("status", "processing");
  }
  return result;
}

async function tryFire(requestId: string): Promise<{ started: boolean; reason?: string }> {
  const routineId = process.env.QUOTE_ROUTINE_ID;
  const token = process.env.QUOTE_ROUTINE_TOKEN;
  if (!routineId || !token) {
    const missing = [!routineId && "QUOTE_ROUTINE_ID", !token && "QUOTE_ROUTINE_TOKEN"].filter(Boolean).join(" and ");
    // Names only (never values) of any similarly named variables, to spot typos or stray whitespace.
    const similar = Object.keys(process.env).filter((k) => /quote|routine/i.test(k));
    return { started: false, reason: `${missing} not set on the server; similar variable names seen: ${similar.length ? similar.map((k) => JSON.stringify(k)).join(", ") : "none"}` };
  }

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
