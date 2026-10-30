import type { ContactType, Database, Json } from "@/lib/types/database";

type PropertyRow = Database["public"]["Tables"]["properties"]["Row"];
type QuoteInsert = Database["public"]["Tables"]["quotes"]["Insert"];

/**
 * Contract a future non-Fetch source (selectsys, ivans) implements too.
 * `buildQuoteFields` maps our property record to that carrier API's request
 * shape; `normalizeRate` maps one of its result rows back to a `quotes` insert.
 */
export interface CarrierQuoteAdapter<TFields, TRate> {
  buildQuoteFields(property: PropertyRow, roofingCompanyOverride?: boolean, referralPartnerType?: ContactType | null): TFields;
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

/** Coverage A the adapter quotes by default for a home of this size. */
export function defaultDwellingA(sqft: number): number {
  return Math.max(Math.round(Number(sqft) * DWELLING_A_PER_SQFT), DWELLING_A_MINIMUM);
}

// Fetch's own default for HO3 Coverage C (personal property) when not set.
export const DEFAULT_PERSONAL_PROPERTY_PCT = 50;

// Year roof-to-wall clips became the default credit this agency quotes on
// an ordinary (non-referral-partner) quote (see buildQuoteFields below).
// Any referral partner (realtor, mortgage broker, or roofing company) uses
// its own, later cutoff — see REFERRAL_PARTNER_CLIP_MIN_YEAR_BUILT.
const HURRICANE_CLIP_MIN_YEAR_BUILT = 1970;

/** Default roof-to-wall attachment credit for a home of this build year. */
function defaultRoofToWallAttachment(yearBuilt: number): FetchQuoteFields["roof_to_wall_attachment"] {
  return yearBuilt >= HURRICANE_CLIP_MIN_YEAR_BUILT ? "Clips" : "Toe nails";
}

// Every referral partner's (realtor, mortgage broker, or roofing company)
// own roof-to-wall cutoff — explicitly set apart from the agency-wide
// HURRICANE_CLIP_MIN_YEAR_BUILT (1970) per instruction.
const REFERRAL_PARTNER_CLIP_MIN_YEAR_BUILT = 1980;

/**
 * Wind-mitigation defaults applied to every referral-partner quote
 * (realtor, mortgage broker, or roofing company), regardless of what this
 * property's own enrichment data says: FBC/Class C roof deck attachment,
 * hurricane clips for homes built 1980+ (toe-nailed before —
 * REFERRAL_PARTNER_CLIP_MIN_YEAR_BUILT), a Gable roof shape, and no
 * impact-rated opening protection assumed. roof_deck_attachment is set
 * explicitly here (not left to Fetch's own matching default) for the same
 * reason plumbing_updated above is: some carrier integrations behind Fetch
 * silently fail on a blank optional rather than surfacing an error.
 */
function referralPartnerWindMitFields(
  yearBuilt: number
): Pick<FetchQuoteFields, "roof_deck_attachment" | "roof_to_wall_attachment" | "roof_shape" | "opening_protection"> {
  return {
    roof_deck_attachment: "Type C (8d @ 6/6)",
    roof_to_wall_attachment: yearBuilt >= REFERRAL_PARTNER_CLIP_MIN_YEAR_BUILT ? "Clips" : "Toe nails",
    roof_shape: "Gable",
    opening_protection: "None",
  };
}

/**
 * The EXTRA wind-mitigation credit a Roofing Company referral's quote
 * claims on top of referralPartnerWindMitFields above: secondary water
 * resistance, assumed done as part of that company's own re-roof work.
 * Only a roofing_company referral (or an explicit "New Roof Scenario"
 * request) gets this — a realtor or mortgage broker referral gets the
 * wind-mit set above but never this.
 */
function roofingCompanyExtraWindMitFields(): Pick<FetchQuoteFields, "secondary_water_resistance"> {
  return {
    secondary_water_resistance: "Yes",
  };
}

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
  buildQuoteFields(property, roofingCompanyOverride, referralPartnerType) {
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

    const dwellingA = defaultDwellingA(Number(property.sqft));

    return {
      ...PLACEHOLDER_INSURED,
      house_number: property.house_number,
      street: property.street,
      city: property.city,
      // property.county is never actually populated (no ingest source sets
      // it), so this was falling back to the city name — an invalid value
      // that made Frontline reject the risk address outright ("An invalid
      // Risk Address county was passed in"). Every property this agency
      // quotes is in Pinellas County, FL, so that's the correct fallback.
      county: property.county ?? "Pinellas",
      state: property.state,
      zipcode: property.zipcode,
      effective_date: todayIso(),
      dwelling_a: String(dwellingA),
      roof_year: String(property.roof_year ?? property.year_built),
      roof_option: "Architectural",
      roof_shape: "Gable",
      square_feet: String(property.sqft),
      year_built: String(property.year_built),
      construction_type_options: mapConstructionType(property.construction),
      protection_class: "8 or less",
      dwelling_type: "Single Family",
      usage: "Primary",
      // Default wind-mitigation credit for a non-referral-partner quote —
      // see defaultRoofToWallAttachment. Overridden below for any referral
      // partner (realtor, mortgage broker, or roofing company), each of
      // which shares referralPartnerWindMitFields's own, later cutoff.
      roof_to_wall_attachment: defaultRoofToWallAttachment(Number(property.year_built)),
      // Not listed in GetApplicationSchema's catalog (a hidden field, same as
      // county was before it started rejecting blanks) — confirmed live that
      // Frontline declines every quote outright with "Fortified Home is
      // required and cannot be left blank" when this is omitted. None of
      // this agency's properties carry IBHS FORTIFIED Home certification, so
      // "No" is the correct answer for every quote, not just Frontline's.
      fortified_home: "No",
      // No dedicated water heater field exists in Fetch's schema — this is
      // the closest available (general plumbing, YYYY format). Not left at
      // Fetch's own default since some carrier integrations behind Fetch
      // silently fail on blank optionals rather than surfacing an error.
      // Never earlier than the build year — plumbing can't predate the house.
      plumbing_updated: String(Math.max(2020, Number(property.year_built))),
      // Any referral partner (realtor, mortgage broker, or roofing company)
      // gets the shared wind-mit trio — see referralPartnerWindMitFields.
      ...(referralPartnerType ? referralPartnerWindMitFields(Number(property.year_built)) : {}),
      // A Roofing Company referral's own EXTRA special quoting rules — see
      // lib/quote-requests/fetch-pipeline.ts's buildFetchQuoteItems, which is
      // the only caller that ever sets this flag. Spread last: it overrides
      // roof_year above regardless of what county-enrichment or any other
      // programming computed, per that referral type's explicit requirement.
      ...(roofingCompanyOverride ? { roof_year: String(new Date().getFullYear()), ...roofingCompanyExtraWindMitFields() } : {}),
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
