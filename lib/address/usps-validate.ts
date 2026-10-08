// USPS Addresses API (OAuth2 client-credentials) — confirms an address is
// actually deliverable before we spend a county-parcel matching attempt on
// it. Added after several quote requests on the night of 2026-10-08 turned
// out to have house numbers thousands off from anything on the named street
// (e.g. "1764 Arabian Lane" when the only Arabian Way in the county starts
// at 20014) — not a typo our own matcher could ever resolve, and not a gap
// in our county sync either. USPS's own database is the authoritative
// source for "is this a real, deliverable US address."
//
// Spec: addresses-v3r2_0.yaml (USPS Addresses API v3.3.1).
// Needs USPS_CONSUMER_KEY / USPS_CONSUMER_SECRET (register an app under the
// "Addresses" API product at https://developer.usps.com).
//
// Never throws — a USPS outage, missing credentials, or rate limit must
// never block a quote request or an ingest run. Callers that care about the
// failure mode get it back as { status: "error", message }; everything else
// treats that the same as "USPS couldn't be reached, proceed without it."

const USPS_BASE_URL = "https://apis.usps.com";
const TOKEN_URL = `${USPS_BASE_URL}/oauth2/v3/token`;
const ADDRESS_URL = `${USPS_BASE_URL}/addresses/v3/address`;
const REQUEST_TIMEOUT_MS = 8000;

export interface AddressToValidate {
  streetAddress: string;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
}

export interface UspsStandardizedAddress {
  streetAddress: string;
  city: string;
  state: string;
  zipCode: string;
  zipPlus4: string | null;
}

export type UspsValidationResult =
  | { status: "valid"; standardized: UspsStandardizedAddress }
  | { status: "not_found"; message: string }
  | { status: "error"; message: string };

interface UspsTokenResponse {
  access_token: string;
  expires_in?: number;
}

interface UspsAddressResponse {
  address?: {
    streetAddress?: string;
    city?: string;
    state?: string;
    ZIPCode?: string;
    ZIPPlus4?: string;
  };
}

interface UspsErrorResponse {
  error?: { message?: string };
}

let cachedToken: { token: string; expiresAt: number } | null = null;

// USPS OAuth tokens are long-lived (hours) — cached in memory and shared
// across calls within this process rather than fetched per address lookup.
async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 30_000) return cachedToken.token;

  const clientId = process.env.USPS_CONSUMER_KEY;
  const clientSecret = process.env.USPS_CONSUMER_SECRET;
  if (!clientId || !clientSecret) throw new Error("USPS_CONSUMER_KEY/USPS_CONSUMER_SECRET not set");

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope: "addresses",
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`USPS OAuth token request failed: HTTP ${res.status}`);

  const json = (await res.json()) as UspsTokenResponse;
  if (!json.access_token) throw new Error("USPS OAuth token response had no access_token");

  cachedToken = { token: json.access_token, expiresAt: now + (json.expires_in ?? 3600) * 1000 };
  return cachedToken.token;
}

/**
 * Confirms an address is a real, deliverable USPS address and returns its
 * standardized form. Requires streetAddress plus either (city and state) or
 * zipCode — matching the API's own requirement.
 */
export async function validateAddress(input: AddressToValidate): Promise<UspsValidationResult> {
  if (!input.streetAddress.trim()) return { status: "error", message: "No street address given" };
  const hasCityState = !!(input.city && input.state);
  if (!hasCityState && !input.zipCode) {
    return { status: "error", message: "Need city+state or a ZIP code to validate an address" };
  }

  try {
    const token = await getAccessToken();

    const params = new URLSearchParams({ streetAddress: input.streetAddress });
    if (input.city) params.set("city", input.city);
    if (input.state) params.set("state", input.state);
    if (input.zipCode) params.set("ZIPCode", input.zipCode);

    const res = await fetch(`${ADDRESS_URL}?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (res.status === 404) {
      const body = (await res.json().catch(() => null)) as UspsErrorResponse | null;
      return { status: "not_found", message: body?.error?.message ?? "Address not found" };
    }
    if (!res.ok) {
      return { status: "error", message: `USPS address API returned HTTP ${res.status}` };
    }

    const body = (await res.json()) as UspsAddressResponse;
    const addr = body.address;
    if (!addr?.streetAddress || !addr?.city || !addr?.state || !addr?.ZIPCode) {
      return { status: "error", message: "USPS response was missing expected address fields" };
    }

    return {
      status: "valid",
      standardized: {
        streetAddress: addr.streetAddress,
        city: addr.city,
        state: addr.state,
        zipCode: addr.ZIPCode,
        zipPlus4: addr.ZIPPlus4 ?? null,
      },
    };
  } catch (err) {
    return { status: "error", message: err instanceof Error ? err.message : "USPS validation failed" };
  }
}
