// Pasco County's own Accela instance (aca-prod.accela.com/PASCO, branded
// "PascoGateway") issues permits ONLY for unincorporated Pasco — confirmed
// against the county's own Building Construction Services page, not just
// inferred. Five of Pasco's six incorporated cities run their own separate
// building departments on platforms that aren't Accela (New Port Richey:
// Tyler EnerGov; Port Richey: no online portal found; Zephyrhills: unknown,
// possibly none; Dade City: unknown, also permits for San Antonio and St.
// Leo under an interlocal agreement) — none of those are covered here yet.
//
// Unlike lib/enrichment/hillsborough-jurisdiction.ts's "unrecognized
// defaults to the broader portal" fallback (reasonable there because HCFL's
// own coverage of small unincorporated communities is genuinely fuzzy),
// Pasco's county portal is confirmed to EXCLUDE these six cities outright,
// so routing an address in one of them to PASCO would just waste a request
// on a search that structurally cannot match. Properties in these cities are
// therefore left unrouted (null) rather than defaulted anywhere, until each
// city's own platform gets its own integration.

const SELF_RUN_CITIES = new Set([
  "new port richey",
  "port richey",
  "zephyrhills",
  "dade city",
  "san antonio", // routed through Dade City by interlocal agreement, not self-run, but still outside PASCO's coverage
  "st. leo",
  "st leo",
  "saint leo",
]);

function normalizeCity(city: string): string {
  return city.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * The Accela agency code covering a Pasco property's permit history, or
 * null if it falls in one of the six cities PASCO's own portal doesn't
 * cover (no integration built yet for any of those).
 */
export function pascoPermitAgency(city: string | null): "PASCO" | null {
  if (city && SELF_RUN_CITIES.has(normalizeCity(city))) return null;
  return "PASCO";
}
