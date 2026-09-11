"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";

export async function approveOutreachAction(outreachId: string) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error("Not signed in");
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
