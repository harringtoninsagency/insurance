import { parseCsv } from "@/lib/contacts/import-csv";
import { normalizePersonName, cleanText } from "@/lib/contacts/normalize";
import type { ContactInput } from "@/lib/contacts/upsert-contact";

/**
 * Parses the Florida Office of Financial Regulation's public "Loan
 * Originators" registration extract (flofr.gov/education/public-information/
 * registration-data-download — three files split alphabetically by last name,
 * A-I / J-R / S-Z; no auth, no robots.txt restriction, refreshed monthly).
 *
 * This is the practical substitute for a full NMLS pull: NMLS's own bulk data
 * (the "NMLS B2B Access" subscription) requires an application and an
 * approved subscription agreement with State Regulatory Registry LLC — not
 * something to sign up for on the agency's behalf without asking. Every
 * mortgage loan originator OFR licenses to do business in Florida carries
 * their NMLS ID in this file, so it still gets Florida loan officers into the
 * directory, keyed by the same NMLS ID a full B2B feed would use later.
 *
 * Unlike DBPR's real estate file, this one licenses originators to lend IN
 * Florida regardless of where they live — most rows are for people in other
 * states, so PRIM STATE must be filtered to "FL" for a local directory (DBPR's
 * file needed no such filter; every row in it already was a Florida license).
 * There is also no employer/brokerage column at all here, so companyName is
 * always null — a real content gap against the realtor side, not a bug.
 */

const HEADER_ALIASES = {
  nmlsId: "NMLS ID",
  lastName: "LAST NAME",
  firstName: "FIRST NAME",
  middleName: "MIDDLE NAME",
  city: "PRIM CITY",
  county: "COUNTY",
  state: "PRIM STATE",
  phone: "PHONE",
  status: "STATUS",
} as const;

export interface ParseFlofrOptions {
  /** Case-insensitive county names to keep. Omit for every Florida county in the files. */
  counties?: string[];
  /** Default true — the files include Expired/Terminated/Revoked/etc. licenses, which aren't practicing loan originators. */
  activeOnly?: boolean;
}

export interface ParseFlofrResult {
  contacts: ContactInput[];
  totalRows: number;
  floridaRows: number;
  skippedMalformed: number;
}

/** Parses one of the three CSVs. Call once per file and merge the `contacts` arrays — see scripts/import-mortgage-broker-licenses.ts. */
export function parseFlofrLoanOriginatorsCsv(csvText: string, options: ParseFlofrOptions = {}): ParseFlofrResult {
  const activeOnly = options.activeOnly ?? true;
  const counties = options.counties?.map((c) => c.toLowerCase().trim());

  const [header, ...rows] = parseCsv(csvText);
  const result: ParseFlofrResult = { contacts: [], totalRows: rows.length, floridaRows: 0, skippedMalformed: 0 };
  if (!header) return result;

  const colIndex = Object.fromEntries(
    Object.entries(HEADER_ALIASES).map(([key, headerName]) => [key, header.indexOf(headerName)])
  ) as Record<keyof typeof HEADER_ALIASES, number>;
  const missing = Object.entries(colIndex).filter(([, i]) => i < 0);
  if (missing.length) {
    throw new Error(`FLOFR loan originator file is missing expected column(s): ${missing.map(([k]) => k).join(", ")}`);
  }

  for (const row of rows) {
    if (row.length !== header.length) {
      result.skippedMalformed += 1;
      continue;
    }
    const get = (key: keyof typeof HEADER_ALIASES) => row[colIndex[key]]?.trim() ?? "";

    // Licensed to lend IN Florida, not necessarily based here — most rows are
    // out-of-state originators. A local referral directory only wants the ones
    // actually in Florida.
    if (get("state") !== "FL") continue;
    result.floridaRows += 1;

    if (activeOnly && get("status") !== "Approved") continue;
    const county = get("county");
    if (counties && !counties.includes(county.toLowerCase())) continue;

    const fullName = normalizePersonName([get("firstName"), get("middleName"), get("lastName")].filter(Boolean).join(" "));
    if (!fullName) continue;

    result.contacts.push({
      contactType: "mortgage_broker",
      fullName,
      companyName: null, // not present in this file — see module comment
      officePhone: get("phone") || null, // rarely filled, and never known to be a cell — see upsertContact's phone handling elsewhere in this app
      licenseNumber: get("nmlsId") || null,
      city: cleanText(get("city")),
      source: "public_license",
      sourceDetail: `Florida OFR loan originator registration (NMLS ID)${county ? `, ${county} County` : ""}`,
    });
  }

  return result;
}
