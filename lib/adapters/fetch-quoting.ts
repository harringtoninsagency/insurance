import type { Database, Json } from "@/lib/types/database";

type PropertyRow = Database["public"]["Tables"]["properties"]["Row"];
type QuoteInsert = Database["public"]["Tables"]["quotes"]["Insert"];

/**
 * Contract a future non-Fetch source (selectsys, ivans) implements too.
 * `buildQuoteFields` maps our property record to that carrier API's request
 * shape; `normalizeRate` maps one of its result rows back to a `quotes` insert.
 */
export interface CarrierQuoteAdapter<TFields, TRate> {
  buildQuoteFields(property: PropertyRow, carrierKey?: string, formType?: string): TFields;
  normalizeRate(rate: TRate, ctx: NormalizeContext): QuoteInsert;
}

export interface NormalizeContext {
  agencyId: string;
  propertyId: string;
  quoteRequestId: string;
}

// Fetch's application field values are placeholder/indicative-only: no buyer
// is confirmed yet at listing stage, so there's no real insured to reason
// from. See GetApplicationSchema("home") for the full field catalog this
// maps into.
// occupancy/usage default to "Owner"/"Primary" (not the property's actual
// vacant listing status) — confirmed live against real carriers that
// "Vacant" tanks quotability (most carriers decline vacant risk outright).
// An indicative primary-residence estimate is far more useful for outreach
// than an accurate-but-mostly-uninsurable vacant quote.
const PLACEHOLDER_INSURED = {
  first_name: "Prospective",
  last_name: "Buyer",
  insured_email: "prospective.buyer@example.com",
  insured_phone: "8135551234",
  insured_date_of_birth: "1985-01-01",
  ownership: "Individual",
  phone_type: "Mobile",
  occupancy: "Owner",
} as const;

// Coverage A (dwelling replacement value) reasoning for indicative quotes:
// $/sqft rebuild cost, not list price (land value skews list price and isn't
// insurable). Revisit once Phase 4 has real replacement-cost modeling.
const DWELLING_A_PER_SQFT = 200;

// Dwelling (Coverage A) floor applied across all carriers: confirmed live
// that Frontline silently zeroes quotes below $350k with no error message,
// and separately, American Traditions/Olympus/Patriot Select all explicitly
// cite a $250k Coverage A minimum in their response messages for a smaller
// (1,107 sqft) property. $350k covers both — a blanket floor generalizes
// better than tracking each carrier's own minimum individually, and no
// carrier has shown a problem being quoted *above* its actual minimum.
const DWELLING_A_MINIMUM = 350_000;

// Universal P&C's DP3 quotes reject occupancy: Owner ("Coverage is
// unavailable for this combination of policy type, occupancy, and wind
// coverage", returned as a placeholder $128, not a real error) — DP3 is a
// Dwelling Fire form typically written for non-owner-occupied risk, and this
// carrier apparently validates that. Confirmed this is carrier-specific, not
// a general Fetch/DP3 issue: switching occupancy to Tenant/Rental for ALL
// carriers' DP3 quotes fixed Universal P&C but broke two others that were
// previously pricing fine with Owner (Florida Peninsula: new "Tenant
// occupied risks must specify applicable Rental Frequency" error; Amwins:
// silently returned null with no message) — so this override is scoped to
// Universal P&C's DP3 quotes only, same carrier-scoping pattern as
// CARRIER_DWELLING_A_MINIMUMS above. Every other carrier's DP3 quote keeps
// Owner/Primary.
const CARRIER_DP3_OCCUPANCY_OVERRIDES: Record<string, { occupancy: string; usage: string }> = {
  "universal-p-c": { occupancy: "Tenant", usage: "Rental" },
};

const CONSTRUCTION_TYPE_MAP: Record<string, string> = {
  frame: "Frame",
  masonry: "Masonry",
  "masonry veneer": "Masonry Veneer",
  superior: "Superior",
};

function mapConstructionType(construction: string | null): string {
  if (!construction) return "Masonry";
  return CONSTRUCTION_TYPE_MAP[construction.trim().toLowerCase()] ?? "Masonry";
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Fields keyed by GetApplicationSchema("home") field codes. */
export type FetchQuoteFields = Record<string, string>;

export interface FetchRate {
  id: string;
  carrier: string;
  form_type?: string | null;
  status?: string | null;
  premium?: number | string | null;
  coverages?: Json | null;
  credits?: Json | null;
  [key: string]: unknown;
}

export const fetchQuotingAdapter: CarrierQuoteAdapter<FetchQuoteFields, FetchRate> = {
  buildQuoteFields(property, carrierKey, formType) {
    if (!property.house_number || !property.street || !property.city || !property.zipcode) {
      throw new Error(
        `Property ${property.id} is missing structured address fields (house_number/street/city/zipcode) required by Fetch's quote API`
      );
    }
    if (!property.year_built || !property.sqft) {
      throw new Error(
        `Property ${property.id} is missing year_built/sqft needed to reason Fetch's required dwelling_a/year_built/square_feet fields`
      );
    }

    const dwellingA = Math.max(
      Math.round(Number(property.sqft) * DWELLING_A_PER_SQFT),
      DWELLING_A_MINIMUM
    );

    return {
      ...PLACEHOLDER_INSURED,
      house_number: property.house_number,
      street: property.street,
      city: property.city,
      county: property.county ?? property.city,
      state: property.state,
      zipcode: property.zipcode,
      effective_date: todayIso(),
      dwelling_a: String(dwellingA),
      roof_year: String(property.roof_year ?? property.year_built),
      roof_option: "Architectural",
      roof_shape: "Hip",
      square_feet: String(property.sqft),
      year_built: String(property.year_built),
      construction_type_options: mapConstructionType(property.construction),
      protection_class: "8 or less",
      dwelling_type: "Single Family",
      usage: "Primary",
      // No dedicated water heater field exists in Fetch's schema — this is
      // the closest available (general plumbing, YYYY format). Not left at
      // Fetch's own default since some carrier integrations behind Fetch
      // silently fail on blank optionals rather than surfacing an error.
      plumbing_updated: "2020",
      ...(formType?.toLowerCase() === "dp3" && carrierKey ? (CARRIER_DP3_OCCUPANCY_OVERRIDES[carrierKey] ?? {}) : {}),
    };
  },

  normalizeRate(rate, ctx) {
    return {
      agency_id: ctx.agencyId,
      property_id: ctx.propertyId,
      carrier: rate.carrier,
      adapter: "fetch_quoting",
      premium:
        rate.premium != null ? Number(String(rate.premium).replace(/,/g, "")) : null,
      coverages: rate.coverages ?? null,
      credits: rate.credits ?? null,
      is_indicative: true,
      external_quote_request_id: ctx.quoteRequestId,
      external_rate_id: rate.id,
      form_type: rate.form_type ?? null,
      raw_response: rate as unknown as Json,
    };
  },
};
