import { createServiceSupabase } from "@/lib/supabase/server";
import { splitStreetAddress, type ParsedListing } from "@/lib/ingest/onehome-email";
import type { Database } from "@/lib/types/database";

type PropertyInsert = Database["public"]["Tables"]["properties"]["Insert"];

export interface ApplyOneHomeListingsResult {
  inserted: number;
  updated: number;
  skipped: number;
}

/**
 * Upserts parsed OneHome listings into `properties` on (agency_id, mls_id).
 * Structured address fields are populated the same way the Fetch quoting and
 * county-parcel matching adapters expect (house_number/street split), so a
 * freshly-ingested property is immediately eligible for "Pull county data"
 * with no extra manual entry.
 */
export async function applyOneHomeListings(
  agencyId: string,
  listings: ParsedListing[]
): Promise<ApplyOneHomeListingsResult> {
  const supabase = createServiceSupabase();
  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const listing of listings) {
    let houseNumber: string;
    let street: string;
    try {
      ({ houseNumber, street } = splitStreetAddress(listing.streetAddress));
    } catch (err) {
      console.warn(`Skipping listing ${listing.mlsId}: ${(err as Error).message}`);
      skipped += 1;
      continue;
    }

    const { data: existing } = await supabase
      .from("properties")
      .select("id")
      .eq("agency_id", agencyId)
      .eq("mls_id", listing.mlsId)
      .maybeSingle();

    const row: PropertyInsert = {
      agency_id: agencyId,
      mls_id: listing.mlsId,
      source: "onehome" as const,
      address: `${listing.streetAddress}, ${listing.city}, ${listing.state}${listing.zip ? ` ${listing.zip}` : ""}`,
      house_number: houseNumber,
      street,
      city: listing.city,
      state: listing.state,
      list_price: listing.listPrice,
      beds: listing.beds,
      baths: listing.baths,
      sqft: listing.sqft,
    };
    // Some ingest sources (e.g. the CSV export) don't carry a zip — never
    // clobber an already-known property's zipcode with a blank one.
    if (listing.zip) row.zipcode = listing.zip;

    if (existing) {
      const { error } = await supabase.from("properties").update(row).eq("id", existing.id);
      if (error) throw new Error(`Failed to update listing ${listing.mlsId}: ${error.message}`);
      updated += 1;
    } else {
      const { error } = await supabase.from("properties").insert({ ...row, status: "new" });
      if (error) throw new Error(`Failed to insert listing ${listing.mlsId}: ${error.message}`);
      inserted += 1;
    }
  }

  return { inserted, updated, skipped };
}
