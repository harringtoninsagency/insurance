// Pinellas County has no single building department — permit records are
// split between Pinellas County BDRS (which acts as building official for
// unincorporated Pinellas County plus 7 partner communities) and each other
// city's own building department. Source: PCCLB's "County & Municipal
// Building Departments" directory (pcclb.com/pdf/County-Municipal-Building-Departments.pdf,
// updated January 2025) — its "Pinellas County BDRS – Unincorporated Pinellas
// County" table lists these as the only BDRS-served municipalities:
const BDRS_PARTNER_CITIES = new Set([
  "belleair beach",
  "belleair bluffs",
  "belleair shore",
  "indian rocks beach",
  "kenneth city",
  "oldsmar",
  "safety harbor",
]);

// Every other incorporated Pinellas city runs its own building department
// (per the same directory). Anything NOT in this set — including genuinely
// unincorporated communities like Palm Harbor or Crystal Beach, which the
// directory doesn't enumerate by name — is BDRS-covered by definition.
const SELF_RUN_CITIES = new Set([
  "belleair",
  "clearwater",
  "dunedin",
  "gulfport",
  "indian shores",
  "largo",
  "madeira beach",
  "north redington beach",
  "pinellas park",
  "redington beach",
  "redington shores",
  "seminole",
  "south pasadena",
  "st petersburg",
  "st. petersburg",
  "st pete beach",
  "st. pete beach",
  "tarpon springs",
  "treasure island",
]);

function normalizeCity(city: string): string {
  return city.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * True if Pinellas County BDRS is the building official for this city (so its
 * Access Portal is the source of truth for permit history), false if the city
 * runs its own separate building department. An unrecognized or missing city
 * defaults to BDRS-covered, since everything BDRS doesn't explicitly hand off
 * to a partner community it either serves directly or is unincorporated
 * territory it also serves.
 */
export function isBdrsCovered(city: string | null): boolean {
  if (!city) return true;
  const normalized = normalizeCity(city);
  if (BDRS_PARTNER_CITIES.has(normalized)) return true;
  return !SELF_RUN_CITIES.has(normalized);
}
