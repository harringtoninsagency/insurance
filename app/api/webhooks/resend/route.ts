import { createServiceSupabase } from "@/lib/supabase/server";
import { handleResendEvent, verifySvixSignature } from "@/lib/outreach/webhook";

// Resend calls this with bounce/complaint events. Public by necessity (the
// login gate is opened for this path in proxy.ts), so nothing is trusted until
// the Svix signature over the raw body checks out.
export async function POST(request: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return new Response("Webhook not configured", { status: 503 });

  const rawBody = await request.text();
  const valid = verifySvixSignature(
    rawBody,
    {
      id: request.headers.get("svix-id"),
      timestamp: request.headers.get("svix-timestamp"),
      signature: request.headers.get("svix-signature"),
    },
    secret
  );
  if (!valid) return new Response("Invalid signature", { status: 401 });

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  try {
    const outcome = await handleResendEvent(createServiceSupabase(), event);
    return Response.json({ ok: true, outcome });
  } catch (err) {
    console.error("Resend webhook failed:", err);
    // A 5xx makes Resend retry, which is what we want for a database hiccup.
    return new Response("Processing failed", { status: 500 });
  }
}
