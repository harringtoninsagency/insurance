import { sendDueQuoteRequestFollowUps } from "@/lib/quote-requests/follow-ups";

// Vercel Cron hits this every weekday morning (vercel.json) with
// "Authorization: Bearer <CRON_SECRET>" — Vercel sets that header itself
// from the project's CRON_SECRET env var. Public by necessity (proxy.ts
// already excludes /api/cron from the login gate), so nothing runs until
// the secret checks out. Can also be triggered by hand with the same header
// for a one-off catch-up run.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return new Response("CRON_SECRET not configured", { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) return new Response("Unauthorized", { status: 401 });

  try {
    const summary = await sendDueQuoteRequestFollowUps();
    console.log(`quote-follow-ups: ${summary.sent} sent, ${summary.stopped} stopped, ${summary.failed} failed, ${summary.skipped} skipped of ${summary.due} due`);
    return Response.json({ ok: true, ...summary });
  } catch (err) {
    console.error("quote-follow-ups cron failed:", err);
    return new Response(err instanceof Error ? err.message : "Run failed", { status: 500 });
  }
}
