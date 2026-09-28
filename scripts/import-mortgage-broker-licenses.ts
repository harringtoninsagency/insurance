// Imports Florida mortgage loan originators from the Florida Office of
// Financial Regulation's public "Loan Originators" registration extract into
// `industry_contacts` as the mortgage-broker target list (name, city, NMLS ID
// — no company/brokerage field in this file, no phone for ~99% of rows; see
// docs/realtor-broker-sourcing-plan.md). Re-runnable: matches by NMLS ID (used
// as the stored license number) and only fills in blanks.
//
// Source: https://flofr.gov/education/public-information/registration-data-download
// Three files, split alphabetically by last name (not by county — unlike
// DBPR's real estate file, all three must be pulled to cover any one county),
// updated monthly, no auth:
//   https://real.flofr.com/Public/LO/LoanOriginators_AI_Monthly.zip
//   https://real.flofr.com/Public/LO/LoanOriginators_JR_Monthly.zip
//   https://real.flofr.com/Public/LO/LoanOriginators_SZ_Monthly.zip
//
// This is a substitute for NMLS's own bulk data: NMLS's "B2B Access" service
// needs a subscription application to State Regulatory Registry LLC, which is
// a business decision for the agency to make, not something to sign up for
// here. Every originator in this file still carries their real NMLS ID.
//
// Usage:
//   npx tsx scripts/import-mortgage-broker-licenses.ts [--counties "Pinellas,Pasco"] [--all-statuses] [--dry-run]
//   npx tsx scripts/import-mortgage-broker-licenses.ts --files a.csv,b.csv,c.csv --counties Pinellas
//
// --counties omitted = every Florida county in the files. --all-statuses also
// imports expired/terminated/revoked licenses (default is Approved only).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import unzipper from "unzipper";
process.loadEnvFile(resolve(import.meta.dirname, "../.env.local"));

import { createServiceSupabase } from "@/lib/supabase/server";
import { parseFlofrLoanOriginatorsCsv, type ParseFlofrResult } from "@/lib/contacts/flofr-loan-originators";
import { upsertContact } from "@/lib/contacts/upsert-contact";

const AGENCY_ID = "ccb0a58e-0b78-4799-b236-66d1bda42f67";

const SOURCE_FILES = [
  "https://real.flofr.com/Public/LO/LoanOriginators_AI_Monthly.zip",
  "https://real.flofr.com/Public/LO/LoanOriginators_JR_Monthly.zip",
  "https://real.flofr.com/Public/LO/LoanOriginators_SZ_Monthly.zip",
];

function parseArgs(argv: string[]) {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    files: get("--files")
      ?.split(",")
      .map((f) => f.trim())
      .filter(Boolean),
    counties: get("--counties")
      ?.split(",")
      .map((c) => c.trim())
      .filter(Boolean),
    allStatuses: argv.includes("--all-statuses"),
    dryRun: argv.includes("--dry-run"),
  };
}

/** The state's download is a zip with one CSV inside — confirmed against a real download, not assumed. */
async function downloadAndUnzipCsv(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed for ${url}: HTTP ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const directory = await unzipper.Open.buffer(buffer);
  const csvEntry = directory.files.find((f) => f.path.toLowerCase().endsWith(".csv"));
  if (!csvEntry) throw new Error(`No .csv file found inside ${url}`);
  const content = await csvEntry.buffer();
  // The file has at least one non-UTF-8 byte (confirmed against a real
  // download — an address field), so decode as latin1 rather than risk
  // silently mangling a name.
  return content.toString("latin1");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const csvTexts: string[] = [];
  if (args.files) {
    for (const path of args.files) csvTexts.push(readFileSync(resolve(path), "latin1"));
  } else {
    for (const url of SOURCE_FILES) {
      console.log(`Downloading ${url} ...`);
      csvTexts.push(await downloadAndUnzipCsv(url));
    }
  }

  const merged: ParseFlofrResult = { contacts: [], totalRows: 0, floridaRows: 0, skippedMalformed: 0 };
  for (const csvText of csvTexts) {
    const parsed = parseFlofrLoanOriginatorsCsv(csvText, { counties: args.counties, activeOnly: !args.allStatuses });
    merged.contacts.push(...parsed.contacts);
    merged.totalRows += parsed.totalRows;
    merged.floridaRows += parsed.floridaRows;
    merged.skippedMalformed += parsed.skippedMalformed;
  }

  console.log(
    `${merged.totalRows} total rows across ${csvTexts.length} file(s), ${merged.floridaRows} Florida-based originators, ` +
      `${merged.contacts.length} match the filters (${merged.skippedMalformed} malformed rows skipped).`
  );
  if (args.counties) console.log(`Counties: ${args.counties.join(", ")}`);
  console.log(`Status: ${args.allStatuses ? "all statuses" : "Approved only"}`);

  if (args.dryRun) {
    console.log("\n--dry-run: no database changes. First 10 matches:");
    console.table(merged.contacts.slice(0, 10).map((c) => ({ name: c.fullName, city: c.city, phone: c.officePhone, nmlsId: c.licenseNumber })));
    return;
  }

  const supabase = createServiceSupabase();
  const tally = { inserted: 0, updated: 0, unchanged: 0, rejected: 0 };
  const rejections: string[] = [];
  for (const [i, contact] of merged.contacts.entries()) {
    const outcome = await upsertContact(supabase, AGENCY_ID, contact);
    if (outcome.result === "rejected") {
      tally.rejected += 1;
      if (rejections.length < 20) rejections.push(`${contact.fullName}: ${outcome.reason}`);
    } else {
      tally[outcome.result] += 1;
    }
    if ((i + 1) % 2000 === 0) console.log(`  ...${i + 1}/${merged.contacts.length}`);
  }

  console.log(`\nDone: ${tally.inserted} added, ${tally.updated} enriched, ${tally.unchanged} already complete, ${tally.rejected} rejected.`);
  for (const r of rejections) console.log(`  rejected: ${r}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
