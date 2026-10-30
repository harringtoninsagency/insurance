import { createServerSupabase } from "@/lib/supabase/server";
import { applyOneHomeListings } from "@/lib/ingest/apply-onehome-listings";
import { applyOneHomePhotos } from "@/lib/ingest/apply-onehome-photos";
import type { ParsedListing, ListingPhoto } from "@/lib/ingest/onehome-email";

// Photo downloads dominate — ~0.5s each from api.cotality.com — so a chunk of
// ~15 listings fits comfortably; the caller (the `onehome-photos` skill) sends
// the full scrape in chunks of that size rather than one giant request.
export const maxDuration = 60;

const MAX_PER_REQUEST = 25;

interface IncomingListing extends ParsedListing {
  photoUrl?: string | null;
}

function isValidListing(x: unknown): x is IncomingListing {
  if (!x || typeof x !== "object") return false;
  const l = x as Record<string, unknown>;
  return (
    typeof l.mlsId === "string" && /^[A-Z0-9]{6,16}$/.test(l.mlsId) &&
    typeof l.listPrice === "number" && l.listPrice > 0 &&
    typeof l.propertyType === "string" &&
    typeof l.streetAddress === "string" && l.streetAddress.length > 0 &&
    typeof l.city === "string" && l.city.length > 0 &&
    typeof l.state === "string" && /^[A-Z]{2}$/.test(l.state) &&
    (l.zip === null || (typeof l.zip === "string" && /^\d{5}$/.test(l.zip))) &&
    typeof l.beds === "number" && typeof l.baths === "number" && typeof l.sqft === "number" &&
    (l.photoUrl == null || (typeof l.photoUrl === "string" && /^https:\/\/(api\.cotality\.com|media\.stellar\.mlsmatrix\.com)\//.test(l.photoUrl)))
  );
}

/**
 * Receives listings scraped from the OneHome saved-search portal page by a
 * signed-in team member's browser (the `onehome-photos` Claude skill drives
 * Chrome, extracts every tile on the "N new or updated listings" page, and
 * POSTs the result here from a tab logged into this app). The server then
 * does what the daily email routine does for the email's own ~10 highlights:
 * upsert `properties` on (agency_id, mls_id) and download each tile's front
 * photo into the listing-photos bucket — immediately, because the portal's
 * photo URLs are signed and expire ~30 minutes after the page loads.
 *
 * Why a route and not the scheduled routine: the portal sits behind
 * bot-detection that only a real browser gets through, and the routine's
 * sandbox has no browser (docs/process-onehome-listings.md, step 1b). A
 * browser the team member is already using plus this server-side apply step
 * covers it without the cloud sandbox needing network access to the photo CDN.
 *
 * Never replaces a photo already on file (applyOneHomePhotos' own rule), and
 * never quotes or sends anything — this is ingest only.
 */
export async function POST(request: Request) {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("agency_id, active")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile?.active || !profile.agency_id) return Response.json({ error: "No active profile" }, { status: 403 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Body must be JSON" }, { status: 400 });
  }
  const raw = (body as { listings?: unknown })?.listings;
  if (!Array.isArray(raw)) return Response.json({ error: "Expected { listings: [...] }" }, { status: 400 });
  if (raw.length > MAX_PER_REQUEST) {
    return Response.json({ error: `Send at most ${MAX_PER_REQUEST} listings per request` }, { status: 413 });
  }

  const listings: ParsedListing[] = [];
  const photos: ListingPhoto[] = [];
  let rejected = 0;
  for (const item of raw) {
    if (!isValidListing(item)) {
      rejected += 1;
      continue;
    }
    const { photoUrl, ...listing } = item;
    listings.push({ ...listing, mlsId: listing.mlsId.toUpperCase() });
    if (photoUrl) photos.push({ mlsId: listing.mlsId.toUpperCase(), url: photoUrl });
  }

  const listingResult = await applyOneHomeListings(profile.agency_id, listings);
  const photoResult = await applyOneHomePhotos(profile.agency_id, photos);

  return Response.json({ received: raw.length, rejected, listings: listingResult, photos: photoResult });
}
