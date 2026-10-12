// One-time (re-runnable) job: for Pasco County properties (identified by
// their matched county_parcels record, same as scripts/backfill-hillsborough-
// roof-years.ts) that fall under Pasco County's own Accela coverage (see
// lib/enrichment/pasco-jurisdiction.ts — unincorporated Pasco only; five of
// the six incorporated cities run their own separate, non-Accela systems and
// aren't covered here yet), searches the county's Access Portal by address
// and, if a re-roof permit is found, sets properties.roof_year to its year.
// Same pattern and the same caveats as the Pinellas and Hillsborough
// scripts: no bulk/API access, only a citizen-facing search form (confirmed
// no bulk permit export exists anywhere in Pasco, including PascoPA's own
// downloads program, which only ever covered parcels/CAMA/sales).
//
// Usage: npx tsx scripts/backfill-pasco-roof-years.ts [property-id]

import { resolve } from "node:path";
process.loadEnvFile(resolve(import.meta.dirname, "../.env.local"));
import { chromium } from "playwright";
import { createServiceSupabase } from "@/lib/supabase/server";
import { pascoPermitAgency } from "@/lib/enrichment/pasco-jurisdiction";
import { normalizeStreetName } from "@/lib/enrichment/county-parcels";

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

  const { data: properties, error: propertiesError } = await supabase
    .from("properties")
    .select("id, address, house_number, street, city")
    .is("roof_year", null);
  if (propertiesError) throw propertiesError;

  // Latest enrichment per property, same idiom as backfill-hillsborough-roof-years.ts.
  const { data: enrichments, error: enrichmentsError } = await supabase
    .from("enrichments")
    .select("property_id, county_appraiser_payload, fetched_at")
    .order("fetched_at", { ascending: false });
  if (enrichmentsError) throw enrichmentsError;

  const countyByProperty = new Map<string, string | null>();
  for (const e of enrichments ?? []) {
    if (countyByProperty.has(e.property_id)) continue;
    const payload = e.county_appraiser_payload as { county?: string } | null;
    countyByProperty.set(e.property_id, payload?.county ?? null);
  }

  // Optional single-property mode: npx tsx scripts/backfill-pasco-roof-years.ts <property-id>
  const onlyId = process.argv[2];
  const targets = (properties ?? [])
    .filter((p) => countyByProperty.get(p.id) === "Pasco" && p.house_number && p.street && (!onlyId || p.id === onlyId))
    .map((p) => ({ ...p, agency: pascoPermitAgency(p.city) }))
    .filter((p): p is typeof p & { agency: "PASCO" } => p.agency !== null);
  console.log(`${targets.length} Pasco properties (within PASCO's own coverage) to search for roof permits.`);

  const browser = await chromium.launch();
  const page = await browser.newPage();

  let matched = 0;
  let searched = 0;
  for (const property of targets) {
    searched += 1;
    const searchUrl = `https://aca-prod.accela.com/${property.agency}/Cap/CapHome.aspx?module=Building&TabName=Building`;
    const streetName = normalizeStreetName(property.street!);
    console.log(`[${searched}/${targets.length}] ${property.address} (house#=${property.house_number}, street="${streetName}")`);

    try {
      await page.goto(searchUrl, { waitUntil: "networkidle" });
      await page.fill("#ctl00_PlaceHolderMain_generalSearchForm_txtGSNumber_ChildControl0", property.house_number!);
      await page.fill("#ctl00_PlaceHolderMain_generalSearchForm_txtGSStreetName", streetName);
      const startDate = page.locator("#ctl00_PlaceHolderMain_generalSearchForm_txtGSStartDate");
      await startDate.click();
      // Confirmed necessary for a pre-filled start-date field (Tampa's
      // Accela instance has one) — select-all before typing so this works
      // whether or not this agency's field comes pre-filled too.
      await startDate.press("Control+A");
      await startDate.pressSequentially(EARLIEST_START_DATE, { delay: 30 });
      await page.keyboard.press("Tab");

      await page.click("#ctl00_PlaceHolderMain_btnNewSearch");
      await page.waitForLoadState("networkidle");
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
