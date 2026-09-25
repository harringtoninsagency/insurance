import { createServerSupabase } from "@/lib/supabase/server";

/** The signed-in user's RLS-scoped client and agency, for session-bound server actions. */
export async function sessionContext() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  const { data: profile } = await supabase.from("profiles").select("agency_id").eq("id", user.id).single();
  if (!profile) throw new Error("No agency profile for this user");
  return { supabase, agencyId: profile.agency_id, userEmail: user.email ?? user.id };
}
