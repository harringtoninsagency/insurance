export interface VerifiedAddress {
  formattedAddress: string;
  lat: number;
  lng: number;
}

export type VerifyAddressResult = { ok: true; address: VerifiedAddress } | { ok: false; error: string };

interface GeocodeResponse {
  status: string;
  error_message?: string;
  results: Array<{
    formatted_address: string;
    geometry: { location: { lat: number; lng: number } };
    partial_match?: boolean;
  }>;
}

/**
 * Geocodes a producer-typed address via Google's Geocoding API before a
 * manual "Run quote now" is allowed to fire — catches a typo'd street name
 * or a city/zip that don't actually match before a carrier quote gets
 * requested for the wrong place. Server-side only: the Geocoding REST
 * endpoint doesn't support CORS, so this can't be called directly from the
 * browser (the Maps Embed API, used for the visual pin, is the client-side
 * half of this feature — see AddressVerification.tsx).
 */
export async function verifyAddress(addressLine: string, city: string, state: string, zipcode: string): Promise<VerifyAddressResult> {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey) return { ok: false, error: "Google Maps isn't configured (missing NEXT_PUBLIC_GOOGLE_MAPS_API_KEY)." };

  const query = [addressLine, city, state, zipcode].filter(Boolean).join(", ");
  if (!addressLine.trim() || !city.trim()) return { ok: false, error: "Enter a street address and city first." };

  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", query);
  url.searchParams.set("region", "us");
  url.searchParams.set("key", apiKey);

  let json: GeocodeResponse;
  try {
    const res = await fetch(url);
    json = (await res.json()) as GeocodeResponse;
  } catch {
    return { ok: false, error: "Couldn't reach Google Maps to verify this address." };
  }

  if (json.status !== "OK") {
    if (json.status === "ZERO_RESULTS") return { ok: false, error: "Google Maps couldn't find this address — check the street, city and zip." };
    return { ok: false, error: `Google Maps error: ${json.error_message ?? json.status}` };
  }

  const result = json.results[0];
  if (!result) return { ok: false, error: "Google Maps couldn't find this address." };
  if (result.partial_match) {
    return { ok: false, error: `Only a partial match found ("${result.formatted_address}") — double-check the address.` };
  }

  return {
    ok: true,
    address: {
      formattedAddress: result.formatted_address,
      lat: result.geometry.location.lat,
      lng: result.geometry.location.lng,
    },
  };
}
