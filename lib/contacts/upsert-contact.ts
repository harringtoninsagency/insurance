import type { SupabaseClient } from "@supabase/supabase-js";
import type { ContactSource, ContactType, Database } from "@/lib/types/database";
import { cleanText, normalizeEmail, normalizePersonName, normalizePhone } from "@/lib/contacts/normalize";

type Client = SupabaseClient<Database>;
type ContactRow = Database["public"]["Tables"]["industry_contacts"]["Row"];

export interface ContactInput {
  contactType: ContactType;
  fullName?: string | null;
  companyName?: string | null;
  cellPhone?: string | null;
  officePhone?: string | null;
  email?: string | null;
  licenseNumber?: string | null;
  city?: string | null;
  source: ContactSource;
  sourceDetail?: string | null;
}

export type UpsertOutcome =
  | { result: "inserted" | "updated" | "unchanged"; id: string }
  | { result: "rejected"; reason: string };

// ilike treats % and _ as wildcards; underscores are common in emails.
export const escapeLike = (v: string) => v.replace(/[\\%_]/g, (c) => `\\${c}`);

const FILLABLE = ["company_name", "cell_phone", "office_phone", "email", "license_number", "city"] as const;

/**
 * Adds a contact, or enriches the existing one. A person is matched by email,
 * then by license number, then by exact name + company, so re-importing a
 * list never duplicates anyone. Merging only fills fields that are currently
 * empty — it never overwrites data a person already has, and never touches
 * consent flags or do_not_contact.
 */
export async function upsertContact(supabase: Client, agencyId: string, input: ContactInput): Promise<UpsertOutcome> {
  const fullName = normalizePersonName(input.fullName);
  if (!fullName) return { result: "rejected", reason: "missing name" };

  const email = normalizeEmail(input.email);
  if (input.email?.trim() && !email) return { result: "rejected", reason: `invalid email "${input.email.trim()}"` };

  const candidate = {
    company_name: cleanText(input.companyName),
    cell_phone: normalizePhone(input.cellPhone),
    office_phone: normalizePhone(input.officePhone),
    email,
    license_number: cleanText(input.licenseNumber)?.toUpperCase() ?? null,
    city: cleanText(input.city),
  };

  const existing = await findExisting(supabase, agencyId, input.contactType, fullName, candidate);

  if (!existing) {
    const { data, error } = await supabase
      .from("industry_contacts")
      .insert({
        agency_id: agencyId,
        contact_type: input.contactType,
        full_name: fullName,
        ...candidate,
        source: input.source,
        source_detail: cleanText(input.sourceDetail),
      })
      .select("id")
      .single();
    if (error || !data) return { result: "rejected", reason: error?.message ?? "insert failed" };
    return { result: "inserted", id: data.id };
  }

  const patch: Partial<ContactRow> = {};
  for (const field of FILLABLE) {
    if (existing[field] == null && candidate[field] != null) patch[field] = candidate[field] as never;
  }
  if (!Object.keys(patch).length) return { result: "unchanged", id: existing.id };

  const { error } = await supabase
    .from("industry_contacts")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", existing.id);
  // A filled-in email/license can collide with another row's; that just means
  // two records for one person — surface it instead of failing the whole import.
  if (error) return { result: "rejected", reason: error.message };
  return { result: "updated", id: existing.id };
}

async function findExisting(
  supabase: Client,
  agencyId: string,
  contactType: ContactType,
  fullName: string,
  candidate: { email: string | null; license_number: string | null; company_name: string | null }
): Promise<ContactRow | null> {
  const base = () => supabase.from("industry_contacts").select("*").eq("agency_id", agencyId);

  if (candidate.email) {
    const { data } = await base().ilike("email", escapeLike(candidate.email)).limit(1);
    if (data?.[0]) return data[0];
  }
  if (candidate.license_number) {
    const { data } = await base().eq("contact_type", contactType).eq("license_number", candidate.license_number).limit(1);
    if (data?.[0]) return data[0];
  }
  // Name + company is only trusted when both are present — a bare common name
  // like "John Smith" would otherwise merge different people.
  if (candidate.company_name) {
    const { data } = await base()
      .eq("contact_type", contactType)
      .ilike("full_name", escapeLike(fullName))
      .ilike("company_name", escapeLike(candidate.company_name))
      .limit(1);
    if (data?.[0]) return data[0];
  }
  return null;
}
