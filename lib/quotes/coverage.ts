import { DEFAULT_PERSONAL_PROPERTY_PCT, defaultDwellingA } from "@/lib/adapters/fetch-quoting";

/**
 * Coverage assumptions a set of quotes was priced at. Stored in
 * quotes.coverages by ingestFetchQuoteResults when a run overrides the
 * defaults (e.g. "quote at $1M dwelling, 25% personal property").
 */
export interface QuoteCoverages {
  dwelling_a: number;
  personal_property_pct: number;
}

export interface ResolvedCoverages extends QuoteCoverages {
  /** True when nothing was recorded and these are the adapter's defaults. */
  isDefault: boolean;
}

function isQuoteCoverages(value: unknown): value is QuoteCoverages {
  const v = value as Partial<QuoteCoverages> | null;
  return typeof v?.dwelling_a === "number" && typeof v?.personal_property_pct === "number";
}

/**
 * Coverage assumptions to show on a proposal: the ones recorded on the
 * quotes, else what the adapter defaults to for this home (all quotes run
 * without an explicit override used those defaults), else null if neither is
 * knowable (no recorded coverage and no square footage).
 */
export function resolveCoverages(
  quoteCoverages: unknown[],
  sqft: number | null
): ResolvedCoverages | null {
  const recorded = quoteCoverages.find(isQuoteCoverages);
  if (recorded) return { ...recorded, isDefault: false };
  if (!sqft) return null;
  return {
    dwelling_a: defaultDwellingA(sqft),
    personal_property_pct: DEFAULT_PERSONAL_PROPERTY_PCT,
    isDefault: true,
  };
}

const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;

/** Lines for a proposal's coverage section. */
export function coverageLines(c: ResolvedCoverages): string[] {
  const personalDollars = usd((c.dwelling_a * c.personal_property_pct) / 100);
  return [
    `Coverage A (Dwelling): ${usd(c.dwelling_a)}${c.isDefault ? " (estimated)" : ""}`,
    `Coverage C (Personal Property, HO3): ${c.personal_property_pct}% = ${personalDollars}${c.isDefault ? " (carrier default)" : ""}`,
  ];
}
