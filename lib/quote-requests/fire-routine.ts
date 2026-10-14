import { createServiceSupabase } from "@/lib/supabase/server";
import { loadEmailConfig } from "@/lib/email/config";
import { resendProvider } from "@/lib/email/provider";
import { escapeHtml } from "@/lib/email/escape-html";

const FIRE_THROTTLE_MS = 3 * 60 * 1000;
const FIRE_TIMEOUT_MS = 8000;

// A single failed fire is expected occasionally (a transient API hiccup) and
// isn't worth alerting on — the hourly run still picks the request up either
// way. A STRING of failures is different: it means the on-demand mechanism
// itself is broken (e.g. the exact QUOTE_ROUTINE_ID/QUOTE_ROUTINE_TOKEN
// case-sensitivity issue already hit once, confirmed live, documented
// below), silently degrading every submission from ~2-minute turnaround to
// up to ~59 minutes with nobody the wiser. Alert exactly once when the
// rolling-window count first reaches the threshold, not on every failure
// after that (the window naturally lets it alert again later if the break
// is still there, without spamming on every single request in between).
const FAILURE_ALERT_THRESHOLD = 3;
const FAILURE_ALERT_WINDOW_MS = 24 * 60 * 60 * 1000;
// Same addressee as the other "needs an admin to go check something"
// notification (lib/partners/notify.ts) — not the shared agency inbox,
// since this is a technical alert, not a business lead.
const ALERT_TO = "tim.harrington@brightway.com";

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
    const supabase = createServiceSupabase();
    // Surface why on the request itself (property page / quote requests list) so a failed fire is diagnosable.
    await supabase
      .from("quote_requests")
      .update({
        status_detail: `Queued by a team member — couldn't start the quote run now (${result.reason}); the hourly run will pick it up.`,
        routine_fire_failed_at: new Date().toISOString(),
      })
      .eq("id", requestId)
      .eq("status", "processing");
    await alertIfFailuresPilingUp(supabase, result.reason);
  }
  return result;
}

/**
 * Checks whether recent fire failures have just crossed FAILURE_ALERT_THRESHOLD
 * within FAILURE_ALERT_WINDOW_MS and, if so, emails the agency once. Never
 * throws — an alerting bug must not affect the request it was checking on
 * behalf of.
 */
async function alertIfFailuresPilingUp(supabase: ReturnType<typeof createServiceSupabase>, latestReason?: string): Promise<void> {
  try {
    const since = new Date(Date.now() - FAILURE_ALERT_WINDOW_MS).toISOString();
    const { data: recent, error } = await supabase
      .from("quote_requests")
      .select("id, address_line, city, status_detail, routine_fire_failed_at")
      .gt("routine_fire_failed_at", since)
      .order("routine_fire_failed_at", { ascending: false })
      .limit(FAILURE_ALERT_THRESHOLD);
    if (error || !recent) return;
    // Alert exactly once as the count crosses the threshold, not on every
    // failure after it — this read happens right after this failure was
    // recorded, so a count equal to the threshold means this is the one
    // that tipped it over.
    if (recent.length !== FAILURE_ALERT_THRESHOLD) return;

    const cfg = loadEmailConfig();
    if (!cfg.ok) {
      console.error(`Quote-routine fire failures piling up (couldn't alert — email not configured): ${cfg.missing.join(", ")}`);
      return;
    }

    const windowHours = Math.round(FAILURE_ALERT_WINDOW_MS / (60 * 60 * 1000));
    const list = recent.map((r) => `${r.address_line}, ${r.city} — ${r.status_detail ?? "no detail"}`).join("\n");
    const listHtml = recent.map((r) => `<li>${escapeHtml(`${r.address_line}, ${r.city}`)} — ${escapeHtml(r.status_detail ?? "no detail")}</li>`).join("");

    await resendProvider(cfg.config.apiKey).send({
      from: cfg.config.from,
      to: ALERT_TO,
      replyTo: cfg.config.replyTo,
      subject: "Quote routine isn't starting instantly — check QUOTE_ROUTINE_ID/TOKEN",
      text: [
        `The on-demand quote routine has failed to start ${FAILURE_ALERT_THRESHOLD} times in the last ${windowHours} hours.`,
        "Every affected request still completes via the hourly fallback run — nothing is lost — but submissions are taking up to ~59 minutes instead of the usual ~2.",
        "",
        `Most recent failure: ${latestReason ?? "unknown"}`,
        "",
        "Recently affected requests:",
        list,
        "",
        "Check the QUOTE_ROUTINE_ID and QUOTE_ROUTINE_TOKEN environment variables in Vercel — exact case, e.g. not \"Quote_Routine_ID\".",
      ].join("\n"),
      html: [
        `<p>The on-demand quote routine has failed to start <strong>${FAILURE_ALERT_THRESHOLD}</strong> times in the last ${windowHours} hours.</p>`,
        `<p>Every affected request still completes via the hourly fallback run — nothing is lost — but submissions are taking up to ~59 minutes instead of the usual ~2.</p>`,
        `<p>Most recent failure: ${escapeHtml(latestReason ?? "unknown")}</p>`,
        `<p>Recently affected requests:</p><ul>${listHtml}</ul>`,
        `<p>Check the <code>QUOTE_ROUTINE_ID</code> and <code>QUOTE_ROUTINE_TOKEN</code> environment variables in Vercel — exact case, e.g. not <code>Quote_Routine_ID</code>.</p>`,
      ].join(""),
    });
  } catch (err) {
    console.error(`Failed to send quote-routine-fire-failure alert: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// Env var names are case-sensitive, but easy to mistype when setting them by
// hand in a dashboard — confirmed live: the server had "Quote_Routine_ID" set
// instead of "QUOTE_ROUTINE_ID", which silently degraded every on-demand fire
// to the hourly fallback (the request still completed, just up to ~59 minutes
// later than the UI implies). Exact name first, case-insensitive as a fallback.
function findEnvVar(name: string): string | undefined {
  if (process.env[name]) return process.env[name];
  const lower = name.toLowerCase();
  const key = Object.keys(process.env).find((k) => k.toLowerCase() === lower);
  return key ? process.env[key] : undefined;
}

async function tryFire(requestId: string): Promise<{ started: boolean; reason?: string }> {
  const routineId = findEnvVar("QUOTE_ROUTINE_ID");
  const token = findEnvVar("QUOTE_ROUTINE_TOKEN");
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
