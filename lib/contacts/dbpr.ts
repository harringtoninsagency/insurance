import { parseCsv } from "@/lib/contacts/import-csv";
import { normalizePersonName, cleanText } from "@/lib/contacts/normalize";
import type { ContactInput } from "@/lib/contacts/upsert-contact";

/**
 * Parses Florida DBPR's official "Real Estate Sales Associates and Brokers"
 * public-records extract (myfloridalicense.com/real-estate-commission/public-records/,
 * one file per DBPR region — Pinellas/Pasco/Hillsborough/Manatee/Hernando/Polk/
 * Hardee are all Region 6). Unlike every other CSV this app imports, the file
 * has **no header row**: columns are fixed by position, confirmed against a
 * real download (23 columns; documented layout on the page above groups a few
 * of these together, so the exact split here was verified against sample rows,
 * not just the page's prose description). Only carries name/company/license/
 * city — DBPR's own site confirms it has no phone or email columns, which is
 * why this only builds the *target list* layer of the sourcing plan, not
 * ready-to-contact records (see docs/realtor-broker-sourcing-plan.md).
 */

const COL = {
  licenseCode: 1, // e.g. "2501 Real Estate Broker or Sales" vs corp/branch/instructor/partnership
  name: 2, // "LAST, FIRST MIDDLE" (individuals) or a company name (non-2501 rows)
  dba: 3,
  rank: 4, // "SL Sales Associate" | "BK Broker" | "BL Broker Sales" for individuals
  city: 8,
  countyName: 12,
  licenseNumber: 13,
  primaryStatus: 14, // "Current" | "Invol Inactive" | "Delinquent" | "Suspended" | "Probation"
  secondaryStatus: 15, // "Active" | "Inactive" | ""
  employerName: 21,
} as const;
const EXPECTED_COLUMNS = 23;

// The individual-license row type (corporations/branch offices/instructors/
// partnerships are separate rows we don't want as "realtor" contacts).
const INDIVIDUAL_LICENSE_CODE = "2501 Real Estate Broker or Sales";
const INDIVIDUAL_RANKS = new Set(["SL Sales Associate", "BK Broker", "BL Broker Sales"]);

/**
 * DBPR's own multi-comma edge case ("MCNAUGHTON, JR., JOHN ALLEN") would
 * mis-split under a naive first-comma rule. Splitting on the *last* comma
 * keeps a suffix attached to the last name ("Mcnaughton Jr.") and reduces to
 * the one-comma shape normalizePersonName already handles correctly.
 */
function dbprNameToFullName(licenseeName: string): string | null {
  const parts = licenseeName
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length < 2) return normalizePersonName(licenseeName);
  const first = parts[parts.length - 1]!;
  const last = parts.slice(0, -1).join(" ");
  return normalizePersonName(`${last}, ${first}`);
}

export interface ParseDbprOptions {
  /** Case-insensitive county names to keep (DBPR's own "County Name" column). Omit for every county in the file. */
  counties?: string[];
  /** Default true — DBPR's download includes inactive licensees too; those aren't practicing agents. */
  activeOnly?: boolean;
}

export interface ParseDbprResult {
  contacts: ContactInput[];
  totalRows: number;
  individualRows: number;
  skippedMalformed: number;
}

export function parseDbprRealEstateCsv(csvText: string, options: ParseDbprOptions = {}): ParseDbprResult {
  const activeOnly = options.activeOnly ?? true;
  const counties = options.counties?.map((c) => c.toLowerCase().trim());

  const rows = parseCsv(csvText);
  const result: ParseDbprResult = { contacts: [], totalRows: rows.length, individualRows: 0, skippedMalformed: 0 };

  for (const row of rows) {
    if (row.length !== EXPECTED_COLUMNS) {
      result.skippedMalformed += 1;
      continue;
    }
    if (row[COL.licenseCode] !== INDIVIDUAL_LICENSE_CODE) continue;
    if (!INDIVIDUAL_RANKS.has(row[COL.rank]!)) continue;
    result.individualRows += 1;

    if (activeOnly && (row[COL.primaryStatus] !== "Current" || row[COL.secondaryStatus] !== "Active")) continue;
    const county = row[COL.countyName]!.trim();
    if (counties && !counties.includes(county.toLowerCase())) continue;

    const fullName = dbprNameToFullName(row[COL.name]!);
    if (!fullName) continue;

    result.contacts.push({
      contactType: "realtor",
      fullName,
      // A broker's own DBA (e.g. "George A Alexander Real Estate Broker") beats
      // their employer field, which is blank for the self-employed; an agent's
      // employer (the brokerage they hang their license with) is next. A
      // sole-proprietor broker with neither field set just gets no company —
      // deliberately NOT falling back to the "Self Proprietor's Name" column,
      // which is only ever the licensee's own name again, not a firm name.
      companyName: cleanText(row[COL.dba]) ?? cleanText(row[COL.employerName]),
      licenseNumber: row[COL.licenseNumber],
      city: row[COL.city],
      source: "public_license",
      sourceDetail: `DBPR real estate license extract, ${county} County`,
    });
  }

  return result;
}
