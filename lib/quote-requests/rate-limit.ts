import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { sendSlackAlert } from "@/lib/alerts/slack";

type Client = SupabaseClient<Database>;

export type RateLimitResult = { ok: true } | { ok: false; error: string };

const DEFAULT_DAILY_LIMIT = 10;

/**
 * Per-partner quote-request cap from the "Quote app access and front doors"
 * plan: every address lookup costs Fetch calls and carrier rating hits
 * (possibly per-quote fees), so an unlimited link is a real cost exposure,
 * not just a spam risk. Checked against a rolling 24 hours rather than a
 * calendar day, so a burst right at midnight doesn't reset to zero.
 *
 * A partner hitting their own limit is itself the anomaly worth flagging —
 * normal use never gets close to the default of 10/day — so this fires one
 * Slack alert per block (not per attempt over the limit) rather than
 * tracking a separate, higher "scraper" threshold.
 */
export async function checkPartnerRateLimit(service: Client, contactId: string): Promise<RateLimitResult> {
  const { data: contact } = await service.from("industry_contacts").select("full_name, daily_request_limit").eq("id", contactId).single();
  const limit = contact?.daily_request_limit ?? DEFAULT_DAILY_LIMIT;

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count } = await service
    .from("quote_requests")
    .select("id", { count: "exact", head: true })
    .eq("contact_id", contactId)
    .gte("created_at", since);

  if ((count ?? 0) < limit) return { ok: true };

  try {
    await sendSlackAlert(
      `Partner rate limit hit: ${contact?.full_name ?? contactId} has submitted ${count} quote requests in the last 24 hours (limit ${limit}). Could be a scraper, a competitor, or a compromised link — worth a look at /contacts/${contactId}.`
    );
  } catch {
    // A failed alert must never block the rate-limit response itself.
  }

  return { ok: false, error: `You've reached your daily limit of ${limit} quote requests. Contact your Brightway representative if you need more.` };
}
