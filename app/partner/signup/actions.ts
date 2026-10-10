"use server";

import { createServiceSupabase } from "@/lib/supabase/server";
import { signUpPartner, type SelfSignupResult } from "@/lib/partners/self-signup";
import { notifyNewPartnerAccount } from "@/lib/partners/notify";
import type { ContactType } from "@/lib/types/database";

export async function signUpPartnerAction(_prev: SelfSignupResult | null, formData: FormData): Promise<SelfSignupResult> {
  const contactType = String(formData.get("contact_type") ?? "") as ContactType;
  if (contactType !== "realtor" && contactType !== "mortgage_broker") {
    return { ok: false, error: "Choose whether you're a realtor or a mortgage broker." };
  }

  const fullName = String(formData.get("full_name") ?? "");
  const email = String(formData.get("email") ?? "");
  const phoneDigits = String(formData.get("phone") ?? "").replace(/\D/g, "");

  try {
    const supabase = createServiceSupabase();
    const result = await signUpPartner(supabase, { fullName, email, phoneDigits, contactType });
    if (result.ok) {
      await notifyNewPartnerAccount({ fullName, email, phoneDigits, contactType });
    }
    return result;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Something went wrong." };
  }
}
