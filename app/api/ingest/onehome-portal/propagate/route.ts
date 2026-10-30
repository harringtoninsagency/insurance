import { createServerSupabase, createServiceSupabase } from "@/lib/supabase/server";
import { normalizeStreetName } from "@/lib/enrichment/county-parcels";
import { attachOneHomePhotoIfListed } from "@/lib/proposals/onehome-photo-match";

export const maxDuration = 60;

/**
 * Copies ingested OneHome MLS front photos onto quote-request properties at
 * the same address that still have no photo or only the NAIP aerial fallback
 * (lib/proposals/onehome-photo-match.ts). New quote requests get this inline
 * in prepareQuoteRequest; this covers the other direction — a home that was
 * quoted first and listed on OneHome later — and is what the onehome-photos
 * skill calls right after it ingests a day's portal scrape. Same auth as the
 * ingest route: any active signed-in profile, scoped to their agency.
 * Pass `{ "dryRun": true }` to count without copying.
 */
export async function POST(request: Request) {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });
  const { data: profile } = await supabase.from("profiles").select("agency_id, active").eq("id", user.id).maybeSingle();
  if (!profile?.active || !profile.agency_id) return Response.json({ error: "No active profile" }, { status: 403 });

  let dryRun = false;
  try {
    dryRun = !!((await request.json()) as { dryRun?: boolean })?.dryRun;
  } catch {
    // empty body is fine
  }

  const service = createServiceSupabase();
  const [{ data: targets }, { data: listed }] = await Promise.all([
    service
      .from("properties")
      .select("id, address, house_number, street, city, zipcode, photo_source")
      .eq("agency_id", profile.agency_id)
      .eq("source", "quote_request")
      .or("photo_path.is.null,photo_source.eq.naip_aerial"),
    service
      .from("properties")
      .select("house_number, street, city, zipcode")
      .eq("agency_id", profile.agency_id)
      .eq("source", "onehome")
      .eq("photo_source", "onehome")
      .not("photo_path", "is", null),
  ]);

  const key = (p: { house_number: string | null; street: string | null; city: string | null; zipcode: string | null }) =>
    p.house_number && p.street
      ? `${p.house_number.toLowerCase()}|${normalizeStreetName(p.street)}|${(p.zipcode ?? "").slice(0, 5) || (p.city ?? "").toLowerCase()}`
      : null;
  const listedKeys = new Set((listed ?? []).map(key).filter(Boolean));

  const attached: string[] = [];
  const failed: { address: string; reason: string }[] = [];
  let candidates = 0;
  for (const p of targets ?? []) {
    const k = key(p);
    if (!k || !listedKeys.has(k)) continue;
    candidates += 1;
    if (dryRun) continue;
    const result = await attachOneHomePhotoIfListed(p.id);
    if (result.status === "attached") attached.push(p.address);
    else if (result.status === "skipped") failed.push({ address: p.address, reason: result.reason });
  }

  return Response.json({ dryRun, scanned: targets?.length ?? 0, candidates, attached: attached.length, addresses: attached, failed });
}
