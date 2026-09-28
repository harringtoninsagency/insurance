"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { checkRecipient } from "@/lib/outreach/check-recipient";
import { loadEmailConfig } from "@/lib/email/config";
import { resendProvider } from "@/lib/email/provider";
import { sendApprovedOutreach } from "@/lib/outreach/send";

export async function approveOutreachAction(outreachId: string) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error("Not signed in");
  }

  // Re-run the gate at approval: the contact may have opted out, or been
  // marked do-not-contact, since this was queued.
  const { data: item, error: itemError } = await supabase
    .from("outreach")
    .select("agency_id, recipient")
    .eq("id", outreachId)
    .single();
  if (itemError || !item) {
    throw new Error(`Outreach ${outreachId} not found: ${itemError?.message ?? "no row"}`);
  }
  const check = await checkRecipient(supabase, item.agency_id, item.recipient);
  if (!check.allowed) {
    throw new Error(`Can't approve: ${check.reason}. Reject this item instead.`);
  }

  const { error } = await supabase
    .from("outreach")
    .update({ status: "approved", approved_by: user.id })
    .eq("id", outreachId);
  if (error) {
    throw new Error(`Failed to approve outreach ${outreachId}: ${error.message}`);
  }

  revalidatePath("/review");
}

export async function rejectOutreachAction(outreachId: string) {
  const supabase = await createServerSupabase();
  const { error } = await supabase.from("outreach").update({ status: "rejected" }).eq("id", outreachId);
  if (error) {
    throw new Error(`Failed to reject outreach ${outreachId}: ${error.message}`);
  }

  revalidatePath("/review");
}

export type SendActionResult = { ok: true; message: string } | { ok: false; error: string };

const MAX_BATCH = 25;
// Resend's default limit is 2 requests/second; stay comfortably under it.
const BATCH_SPACING_MS = 600;

// Sending only ever happens from a producer's explicit click here, on items a
// producer already approved. The signed-in check + RLS-scoped read ensure the
// item belongs to the caller's agency before the service client touches it.
export async function sendOutreachAction(outreachId: string): Promise<SendActionResult> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const cfg = loadEmailConfig();
  if (!cfg.ok) return { ok: false, error: `Email isn't set up yet. Missing: ${cfg.missing.join(", ")}` };

  const { data: item } = await supabase.from("outreach").select("id").eq("id", outreachId).maybeSingle();
  if (!item) return { ok: false, error: "Outreach item not found." };

  const result = await sendApprovedOutreach(outreachId, resendProvider(cfg.config.apiKey), cfg.config);
  revalidatePath("/review");
  switch (result.status) {
    case "sent":
      return { ok: true, message: "Sent." };
    case "skipped":
      return { ok: false, error: result.reason };
    case "blocked":
      return { ok: false, error: `Not sent — ${result.reason}. The item was moved to rejected.` };
    case "failed":
      return { ok: false, error: `Send failed: ${result.error}` };
  }
}

export async function sendAllApprovedAction(): Promise<SendActionResult> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const cfg = loadEmailConfig();
  if (!cfg.ok) return { ok: false, error: `Email isn't set up yet. Missing: ${cfg.missing.join(", ")}` };

  const { data: items } = await supabase
    .from("outreach")
    .select("id")
    .eq("status", "approved")
    .is("sent_at", null)
    .order("created_at", { ascending: true })
    .limit(MAX_BATCH);
  if (!items?.length) return { ok: false, error: "Nothing approved is waiting to be sent." };

  const provider = resendProvider(cfg.config.apiKey);
  const tally = { sent: 0, blocked: 0, failed: 0, skipped: 0 };
  let firstProblem: string | null = null;
  for (const [i, item] of items.entries()) {
    if (i > 0) await new Promise((resolve) => setTimeout(resolve, BATCH_SPACING_MS));
    const result = await sendApprovedOutreach(item.id, provider, cfg.config);
    tally[result.status] += 1;
    if (!firstProblem && result.status !== "sent") {
      firstProblem = result.status === "failed" ? result.error : result.status === "blocked" ? result.reason : result.reason;
    }
  }
  revalidatePath("/review");

  const summary = `${tally.sent} sent` + (tally.blocked ? `, ${tally.blocked} blocked` : "") + (tally.failed ? `, ${tally.failed} failed` : "") + (tally.skipped ? `, ${tally.skipped} skipped` : "");
  const more = items.length === MAX_BATCH ? " Run it again for the next batch." : "";
  if (tally.sent === 0) return { ok: false, error: `${summary}. ${firstProblem ?? ""}` };
  return { ok: true, message: `${summary}.${firstProblem ? ` First problem: ${firstProblem}` : ""}${more}` };
}
