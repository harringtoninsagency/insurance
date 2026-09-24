// One-time (re-runnable) job: for properties in a Pinellas County BDRS-covered
// jurisdiction (see lib/enrichment/building-jurisdiction.ts), searches the
// county's public Access Portal (aca-prod.accela.com/PINELLAS) permit history
// by address and, if a re-roof permit is found, sets properties.roof_year to
// its year. Properties with no qualifying permit are left alone — at quote
// time (lib/adapters/fetch-quoting.ts) a null roof_year falls back to
// year_built, i.e. "assume the roof has never been replaced," which is the
// correct read of "we searched and found no re-roof permit."
//
// The portal has no bulk/API access, only this citizen-facing search form, so
// this drives it with Playwright (one page load + one search per property,
// with a pause between each) rather than treating it as a bulk data source.
// It has no robots.txt (confirmed by direct fetch), and per-address permit
// lookups are exactly what the form is built for.
//
// Usage: npx tsx scripts/backfill-roof-years.ts

import { resolve } from "node:path";
process.loadEnvFile(resolve(import.meta.dirname, "../.env.local"));
import { chromium } from "playwright";
import { createServiceSupabase } from "@/lib/supabase/server";
import { isBdrsCovered } from "@/lib/enrichment/building-jurisdiction";
import { normalizeStreetName } from "@/lib/enrichment/county-parcels";

const SEARCH_URL = "https://aca-prod.accela.com/PINELLAS/Cap/CapHome.aspx?module=Building&TabName=Building";
const EARLIEST_START_DATE = "01/01/1980";
const DELAY_BETWEEN_SEARCHES_MS = 2000;

const ROOF_WORK_PATTERN = /re[- ]?roof|reroof|new roof|roof repl|roof shingl|\broofing\b/i;

interface PermitRow {
  date: string;
  recordType: string;
  projectName: string;
  description: string;
}

function latestRoofPermitYear(rows: PermitRow[]): number | null {
  let latestYear: number | null = null;
  for (const row of rows) {
    const haystack = `${row.recordType} ${row.projectName} ${row.description}`;
    if (!ROOF_WORK_PATTERN.test(haystack)) continue;
    const match = row.date.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!match) continue;
    const year = Number.parseInt(match[3]!, 10);
    if (latestYear === null || year > latestYear) latestYear = year;
  }
  return latestYear;
}

async function main() {
  const supabase = createServiceSupabase();
  const { data: properties, error } = await supabase
    .from("properties")
    .select("id, address, house_number, street, city")
    .is("roof_year", null);
  if (error) throw error;

  // Optional single-property mode: npx tsx scripts/backfill-roof-years.ts <property-id>
  const onlyId = process.argv[2];
  const targets = (properties ?? []).filter(
    (p) => isBdrsCovered(p.city) && p.house_number && p.street && (!onlyId || p.id === onlyId)
  );
  console.log(`${targets.length} BDRS-covered properties to search for roof permits.`);

  const browser = await chromium.launch();
  const page = await browser.newPage();

  let matched = 0;
  let searched = 0;
  for (const property of targets) {
    searched += 1;
    const streetName = normalizeStreetName(property.street!);
    console.log(`[${searched}/${targets.length}] ${property.address} (house#=${property.house_number}, street="${streetName}")`);

    try {
      await page.goto(SEARCH_URL, { waitUntil: "networkidle" });
      await page.fill("#ctl00_PlaceHolderMain_generalSearchForm_txtGSNumber_ChildControl0", property.house_number!);
      await page.fill("#ctl00_PlaceHolderMain_generalSearchForm_txtGSStreetName", streetName);
      const startDate = page.locator("#ctl00_PlaceHolderMain_generalSearchForm_txtGSStartDate");
      await startDate.click();
      await startDate.pressSequentially(EARLIEST_START_DATE, { delay: 30 });
      await page.keyboard.press("Tab");

      await page.click("#ctl00_PlaceHolderMain_btnNewSearch");
      await page.waitForLoadState("networkidle");
      // The grid (or "no results" notice) can still be mid-render right after
      // networkidle fires on this ASP.NET postback — poll briefly rather than
      // querying once, which intermittently raced a still-in-flight
      // navigation and threw "Execution context was destroyed".
      let gridExists: import("playwright").ElementHandle | null = null;
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          gridExists = await page.$("#ctl00_PlaceHolderMain_dgvPermitList_gdvPermitList");
          break;
        } catch {
          await page.waitForTimeout(1000);
        }
      }
      if (!gridExists) {
        console.log("  no results");
        continue;
      }

      const rows: PermitRow[] = await page.$eval("#ctl00_PlaceHolderMain_dgvPermitList_gdvPermitList", (el) => {
        const table = el as HTMLTableElement;
        const dataRows = Array.from(table.rows).slice(2) as HTMLTableRowElement[];
        return dataRows
          .filter((r) => r.cells.length >= 10)
          .map((r) => ({
            date: r.cells[1]?.textContent?.trim() ?? "",
            recordType: r.cells[2]?.textContent?.trim() ?? "",
            projectName: r.cells[7]?.textContent?.trim() ?? "",
            description: r.cells[9]?.textContent?.trim() ?? "",
          }));
      });

      const roofYear = latestRoofPermitYear(rows);
      if (roofYear === null) {
        console.log(`  ${rows.length} permit(s) found, none roof-related`);
        continue;
      }

      const { error: updateError } = await supabase.from("properties").update({ roof_year: roofYear }).eq("id", property.id);
      if (updateError) {
        console.error(`  failed to update: ${updateError.message}`);
        continue;
      }
      matched += 1;
      console.log(`  matched: roof_year=${roofYear}`);
    } catch (err) {
      console.error(`  error searching ${property.address}:`, err);
    }

    await page.waitForTimeout(DELAY_BETWEEN_SEARCHES_MS);
  }

  await browser.close();
  console.log(`Done. ${matched}/${targets.length} properties matched to a roof permit.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
