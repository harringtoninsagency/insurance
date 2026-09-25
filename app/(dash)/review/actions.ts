"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { checkRecipient } from "@/lib/outreach/check-recipient";

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
