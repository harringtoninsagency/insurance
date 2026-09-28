import { createServiceSupabase } from "@/lib/supabase/server";
import { processUnsubscribe } from "@/lib/outreach/unsubscribe";

// RFC 8058 one-click unsubscribe: mail apps show their own "Unsubscribe"
// button that POSTs here directly (the List-Unsubscribe header points at this
// route). Only POST — a GET is left to the confirmation page, so link scanners
// that pre-fetch URLs can't unsubscribe people by accident.
export async function POST(request: Request) {
  const secret = process.env.UNSUBSCRIBE_SECRET;
  const token = new URL(request.url).searchParams.get("t");
  if (!secret || !token) return new Response("Bad request", { status: 400 });

  const result = await processUnsubscribe(createServiceSupabase(), secret, token);
  return result.ok ? new Response("Unsubscribed", { status: 200 }) : new Response(result.error, { status: 400 });
}
