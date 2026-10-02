import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { upsertContact, escapeLike } from "@/lib/contacts/upsert-contact";
import { cleanText, normalizeEmail, normalizePhone } from "@/lib/contacts/normalize";

type Client = SupabaseClient<Database>;

export type ListingAgentResult =
  | { ok: true; directory: "added" | "updated" | "unchanged" | "skipped"; contactId: string | null; note?: string }
  | { ok: false; error: string };

/**
 * Saves a property's listing agent and mirrors it into the Realtors & Brokers
 * directory — creating the entry the first time, and updating that same entry
 * (not creating another) when the agent's phone or email is edited later.
 *
 * The property edit is the source of truth: a directory problem is reported
 * back to the caller instead of failing the save.
 */
export async function saveListingAgent(
  supabase: Client,
  propertyId: string,
  input: { name: string; email: string; phone: string }
): Promise<ListingAgentResult> {
  const name = cleanText(input.name);
  const emailRaw = cleanText(input.email);
  const phoneRaw = cleanText(input.phone);
  if (emailRaw && !normalizeEmail(emailRaw)) return { ok: false, error: "That email address doesn't look right." };
  if (phoneRaw && !normalizePhone(phoneRaw)) return { ok: false, error: "Enter a 10-digit phone number, like 727-555-0123." };
  const email = normalizeEmail(emailRaw);
  const phone = normalizePhone(phoneRaw);

  const { data: before, error: readError } = await supabase
    .from("properties")
    .select("agency_id, address, listing_agent_name, listing_agent_email, listing_agent_phone")
    .eq("id", propertyId)
    .single();
  if (readError || !before) return { ok: false, error: `Property not found: ${readError?.message ?? "no row"}` };

  const { error } = await supabase
    .from("properties")
    .update({ listing_agent_name: name, listing_agent_email: email, listing_agent_phone: phone })
    .eq("id", propertyId);
  if (error) return { ok: false, error: `Couldn't save the listing agent: ${error.message}` };

  if (!name) return { ok: true, directory: "skipped", contactId: null };

  try {
    // If this property already had this same agent on it, the directory entry
    // for them is whichever one matches the values we're replacing — find it
    // so an edited phone or email updates that entry.
    let matchContactId: string | undefined;
    const sameAgentAsBefore = before.listing_agent_name && before.listing_agent_name.trim().toLowerCase() === name.toLowerCase();
    if (sameAgentAsBefore) {
      const prevEmail = normalizeEmail(before.listing_agent_email);
      const prevPhone = normalizePhone(before.listing_agent_phone);
      const base = () => supabase.from("industry_contacts").select("id").eq("agency_id", before.agency_id).eq("contact_type", "realtor");
      if (prevEmail) {
        const { data } = await base().ilike("email", escapeLike(prevEmail)).limit(1);
        matchContactId = data?.[0]?.id;
      }
      if (!matchContactId && prevPhone) {
        const { data } = await base().ilike("full_name", escapeLike(name)).or(`cell_phone.eq.${prevPhone},office_phone.eq.${prevPhone}`).limit(1);
        matchContactId = data?.[0]?.id;
      }
    }

    // The phone on a listing is stored as an office line because it can't be
    // told apart from a cell, and texting a cell needs consent.
    const outcome = await upsertContact(supabase, before.agency_id, {
      contactType: "realtor",
      fullName: name,
      email,
      officePhone: phone,
      source: "listing_agent",
      sourceDetail: `Listing agent on ${before.address}`,
      updateExisting: true,
      matchContactId,
    });
    if (outcome.result === "rejected") {
      return { ok: true, directory: "skipped", contactId: null, note: `Saved here, but not added to the directory: ${outcome.reason}.` };
    }
    return { ok: true, directory: outcome.result === "inserted" ? "added" : outcome.result, contactId: outcome.id };
  } catch (err) {
    return { ok: true, directory: "skipped", contactId: null, note: `Saved here, but the directory update failed: ${err instanceof Error ? err.message : "unknown error"}` };
  }
}
