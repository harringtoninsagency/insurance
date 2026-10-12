// Unlike Pinellas (one Access Portal instance, BDRS, serving every
// BDRS-covered city), Hillsborough's Accela deployment is split across two
// separate agency instances: the City of Tampa runs its own
// (aca-prod.accela.com/TAMPA) and Hillsborough County's HillsGovHub
// (aca-prod.accela.com/HCFL — confirmed Accela-based by following
// hcfl.gov/hghub's redirect) covers unincorporated Hillsborough, per the
// county's own homeowner-permit guidance.
//
// Temple Terrace and Plant City reportedly run their own separate building
// departments too (per a third-party permitting guide, not yet confirmed
// against an official source the way Pinellas's BDRS partner-city list was),
// but no distinct public portal has been identified for either. Routed to
// HCFL as a best-effort default — same "unrecognized defaults to the
// broader portal" reasoning as lib/enrichment/building-jurisdiction.ts's
// Pinellas BDRS logic: a property there either gets a real match if HCFL
// happens to carry it, or comes back with no results, which is no worse than
// leaving roof_year unset.

export type HillsboroughPermitAgency = "TAMPA" | "HCFL";

function normalizeCity(city: string): string {
  return city.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Which Accela agency instance (as an aca-prod.accela.com/<code> path) is
 * the source of truth for a Hillsborough property's permit history.
 */
export function hillsboroughPermitAgency(city: string | null): HillsboroughPermitAgency {
  if (city && normalizeCity(city) === "tampa") return "TAMPA";
  return "HCFL";
}
