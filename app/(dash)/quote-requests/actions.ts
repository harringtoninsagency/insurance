"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { queueNewAddressQuote, queuePropertyQuote, type QueueResult, type Requester } from "@/lib/quote-requests/queue-quote";
import type { QuoteRequestKind } from "@/lib/types/database";

const KINDS: QuoteRequestKind[] = ["quote_summary", "listing_snapshot", "both"];
const asKind = (v: unknown): QuoteRequestKind => (KINDS.includes(v as QuoteRequestKind) ? (v as QuoteRequestKind) : "both");

/** The signed-in, active team member — requests are attributed to them, and run as them (RLS-scoped). */
async function teamMember() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");
  const { data: profile } = await supabase.from("profiles").select("agency_id, email, full_name, active").eq("id", user.id).maybeSingle();
  if (!profile || !profile.active) throw new Error("No active team account for this user.");
  const requester: Requester = { userId: user.id, name: profile.full_name ?? profile.email, email: profile.email, agencyId: profile.agency_id };
  return { supabase, requester };
}

function refresh(propertyId?: string) {
  revalidatePath("/properties");
  revalidatePath("/quote-requests");
  if (propertyId) revalidatePath(`/properties/${propertyId}`);
}

export async function runQuoteForPropertyAction(propertyId: string, kind: QuoteRequestKind = "both"): Promise<QueueResult> {
  try {
    const { supabase, requester } = await teamMember();
    const result = await queuePropertyQuote(supabase, propertyId, requester, asKind(kind));
    refresh(propertyId);
    return result;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Something went wrong." };
  }
}

export type NewQuoteState = { queued: { propertyId: string; alreadyQueued: boolean } } | { error: string } | null;

export async function runQuoteForAddressAction(_prev: NewQuoteState, formData: FormData): Promise<NewQuoteState> {
  const str = (key: string) => String(formData.get(key) ?? "").trim();
  try {
    const { supabase, requester } = await teamMember();
    const result = await queueNewAddressQuote(
      supabase,
      {
        requestKind: asKind(formData.get("request_kind")),
        addressLine: str("address_line"),
        city: str("city"),
        state: str("state") || "FL",
        zipcode: str("zipcode"),
        yearBuilt: str("year_built"),
        sqft: str("sqft"),
        beds: str("beds"),
        baths: str("baths"),
        construction: str("construction"),
        listPrice: str("list_price"),
        dwellingA: str("dwelling_a"),
        personalPropertyPct: str("personal_property_pct"),
      },
      requester
    );
    if (!result.ok) return { error: result.error };
    refresh(result.propertyId);
    return { queued: { propertyId: result.propertyId, alreadyQueued: result.alreadyQueued } };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Something went wrong." };
  }
}
