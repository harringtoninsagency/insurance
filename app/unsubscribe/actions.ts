"use server";

import { createServiceSupabase } from "@/lib/supabase/server";
import { processUnsubscribe } from "@/lib/outreach/unsubscribe";

export type UnsubscribeState = { done: string } | { error: string } | null;

// Public: the signed token in the link is the only authorization needed.
export async function confirmUnsubscribeAction(token: string): Promise<UnsubscribeState> {
  const secret = process.env.UNSUBSCRIBE_SECRET;
  if (!secret) return { error: "Unsubscribe isn't available right now. Please email us and we'll remove you." };

  const result = await processUnsubscribe(createServiceSupabase(), secret, token);
  if (!result.ok) return { error: result.error };

  // Show a masked address so the page confirms which email was removed without exposing it.
  const [local = "", domain = ""] = result.email.split("@");
  return { done: `${local.slice(0, 1)}***@${domain}` };
}
