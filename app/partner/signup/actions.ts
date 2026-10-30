"use server";

import { createServiceSupabase } from "@/lib/supabase/server";
import { submitAccessRequest, type AccessRequestResult } from "@/lib/partners/request-access";
import { notifyNewAccessRequest } from "@/lib/partners/notify";
import type { ContactType } from "@/lib/types/database";

export async function requestAccessAction(_prev: AccessRequestResult | null, formData: FormData): Promise<AccessRequestResult> {
  const contactType = String(formData.get("contact_type") ?? "") as ContactType;
  if (contactType !== "realtor" && contactType !== "mortgage_broker" && contactType !== "roofing_company") {
    return { ok: false, error: "Choose whether you're a realtor, a mortgage broker, or a roofing company." };
  }

  const fullName = String(formData.get("full_name") ?? "");
  const companyName = String(formData.get("company_name") ?? "").trim() || null;
  const email = String(formData.get("email") ?? "");
  const phoneDigits = String(formData.get("phone") ?? "").replace(/\D/g, "");
  const licenseNumber = String(formData.get("license_number") ?? "");
  const buyersPerMonth = String(formData.get("buyers_per_month") ?? "").trim() || null;
  const referralPartnerAgentId = String(formData.get("agent_id") ?? "").trim() || null;

  try {
    const supabase = createServiceSupabase();
    const result = await submitAccessRequest(supabase, {
      fullName,
      companyName,
      email,
      phoneDigits,
      contactType,
      licenseNumber,
      buyersPerMonth,
      referralPartnerAgentId,
    });
    if (result.ok) {
      await notifyNewAccessRequest({ fullName, email, phoneDigits, contactType, licenseNumber });
    }
    return result;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Something went wrong." };
  }
}
