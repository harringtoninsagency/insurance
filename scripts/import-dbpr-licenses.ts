// Imports Florida real estate licensees from DBPR's official public-records
// extract into `industry_contacts` as the realtor target list (name, company,
// city, license number — no phone/email; those are earned separately, see
// docs/realtor-broker-sourcing-plan.md). Re-runnable: matches by license
// number and only fills in blanks, never overwrites contact details a
// producer or the person themselves has since added.
//
// Files are published per DBPR "region" (a bundle of counties), refreshed
// weekly, no auth needed:
//   https://www2.myfloridalicense.com/real-estate-commission/public-records/
// Pinellas/Pasco/Hillsborough/Manatee/Hernando/Polk/Hardee are all Region 6 —
// the whole Tampa Bay area in one file.
//
// Usage:
//   npx tsx scripts/import-dbpr-licenses.ts [--region N] [--counties "Pinellas,Pasco"] [--all-statuses] [--dry-run]
//   npx tsx scripts/import-dbpr-licenses.ts --file path/to/RE_rgn6.csv --counties Pinellas
//
// --counties omitted = every county in the file. --all-statuses also imports
// inactive/delinquent/suspended licenses (default is active-only).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
process.loadEnvFile(resolve(import.meta.dirname, "../.env.local"));

import { createServiceSupabase } from "@/lib/supabase/server";
import { parseDbprRealEstateCsv } from "@/lib/contacts/dbpr";
import { upsertContact } from "@/lib/contacts/upsert-contact";

const AGENCY_ID = "ccb0a58e-0b78-4799-b236-66d1bda42f67";
const DEFAULT_REGION = 6;

function regionUrl(region: number): string {
  return `https://www2.myfloridalicense.com/sto/file_download/extracts/RE_rgn${region}.csv`;
}

function parseArgs(argv: string[]) {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    region: Number(get("--region") ?? DEFAULT_REGION),
    file: get("--file"),
    counties: get("--counties")
      ?.split(",")
      .map((c) => c.trim())
      .filter(Boolean),
    allStatuses: argv.includes("--all-statuses"),
    dryRun: argv.includes("--dry-run"),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  let csvText: string;
  let source: string;
  if (args.file) {
    csvText = readFileSync(resolve(args.file), "utf8");
    source = args.file;
  } else {
    const url = regionUrl(args.region);
    console.log(`Downloading ${url} ...`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
    csvText = await res.text();
    source = url;
  }
  console.log(`Loaded ${(csvText.length / 1024 / 1024).toFixed(1)} MB from ${source}`);

  const parsed = parseDbprRealEstateCsv(csvText, {
    counties: args.counties,
    activeOnly: !args.allStatuses,
  });
  console.log(
    `${parsed.totalRows} total rows, ${parsed.individualRows} individual agent/broker licenses, ` +
      `${parsed.contacts.length} match the filters (${parsed.skippedMalformed} malformed rows skipped).`
  );
  if (args.counties) console.log(`Counties: ${args.counties.join(", ")}`);
  console.log(`Status: ${args.allStatuses ? "all statuses" : "active only"}`);

  if (args.dryRun) {
    console.log("\n--dry-run: no database changes. First 10 matches:");
    console.table(parsed.contacts.slice(0, 10).map((c) => ({ name: c.fullName, company: c.companyName, city: c.city, license: c.licenseNumber })));
    return;
  }

  const supabase = createServiceSupabase();
  const tally = { inserted: 0, updated: 0, unchanged: 0, rejected: 0 };
  const rejections: string[] = [];
  for (const [i, contact] of parsed.contacts.entries()) {
    const outcome = await upsertContact(supabase, AGENCY_ID, contact);
    if (outcome.result === "rejected") {
      tally.rejected += 1;
      if (rejections.length < 20) rejections.push(`${contact.fullName}: ${outcome.reason}`);
    } else {
      tally[outcome.result] += 1;
    }
    if ((i + 1) % 2000 === 0) console.log(`  ...${i + 1}/${parsed.contacts.length}`);
  }

  console.log(`\nDone: ${tally.inserted} added, ${tally.updated} enriched, ${tally.unchanged} already complete, ${tally.rejected} rejected.`);
  for (const r of rejections) console.log(`  rejected: ${r}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
