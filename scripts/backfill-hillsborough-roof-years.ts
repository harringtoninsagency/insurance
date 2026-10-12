// One-time (re-runnable) job: for Hillsborough County properties (identified
// by their matched county_parcels record — see lib/enrichment/apply-county-
// enrichment.ts, which stores the match as enrichments.county_appraiser_
// payload — rather than a city/zip guess, since that's real matched data we
// already trust), searches the right Accela Access Portal by address and, if
// a re-roof permit is found, sets properties.roof_year to its year. Mirrors
// scripts/backfill-roof-years.ts's Pinellas approach — same rationale (no
// bulk/API access, only a citizen-facing search form; Tampa's own bulk
// open-data export was researched and found decommissioned, see commit
// history) and the same "no match = leave it alone, fall back to year_built
// at quote time" behavior on properties with no qualifying permit.
//
// Hillsborough's Accela is split across two separate agency instances (see
// lib/enrichment/hillsborough-jurisdiction.ts): City of Tampa
// (aca-prod.accela.com/TAMPA) and Hillsborough County's HillsGovHub
// (aca-prod.accela.com/HCFL), which this script routes each property to by
// city.
//
// The field IDs (txtGSNumber_ChildControl0, txtGSStreetName, txtGSStartDate)
// and the btnNewSearch control carried over from scripts/backfill-roof-
// years.ts's Pinellas selectors are confirmed live against Tampa's real
// instance: filled correctly, submitted without error. What's NOT yet
// confirmed is a true-positive result — the one real address tested
// (picked because it was the only Hillsborough property on file at the
// time, before any Hillsborough county_parcels rows existed to match
// others against) came back with no results grid, which is the same
// "no permit on file" state the Pinellas script already treats as valid —
// but with no second address known to actually carry a permit, a silent
// failure can't be fully ruled out yet. Worth checking the results of the
// first real run against a handful of addresses rather than assuming every
// zero-result is a true negative.
//
// Also confirmed live: Tampa's Start Date field comes pre-filled (unlike
// Pinellas's blank one) — a plain click+type inserted into the existing
// text rather than replacing it, so the fill below selects-all first.
//
// This sandbox also has real, intermittent connectivity flakiness hitting
// these portals (a handful of subresource requests failing with
// net::ERR_TOO_MANY_RETRIES on a given attempt, succeeding outright on an
// immediate retry, across unrelated domains, with the proxy's own
// diagnostics showing no policy block) — expect occasional hangs/retries
// when running this interactively here; not expected to be a production
// concern wherever this actually executes.
//
// Usage: npx tsx scripts/backfill-hillsborough-roof-years.ts [property-id]

import { resolve } from "node:path";
process.loadEnvFile(resolve(import.meta.dirname, "../.env.local"));
import { chromium } from "playwright";
import { createServiceSupabase } from "@/lib/supabase/server";
import { hillsboroughPermitAgency } from "@/lib/enrichment/hillsborough-jurisdiction";
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

  // Latest enrichment per property (enrichments has no unique-per-property
  // constraint — a re-enrichment run adds a new row rather than replacing
  // the old one), to read which county it actually matched in
  // county_parcels. Ordering the query desc and keeping only the first
  // occurrence per property_id gives the latest row cheaply, same idiom as
  // scripts/apply-roof-permits.ts's per-property lookups.
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

  // Optional single-property mode: npx tsx scripts/backfill-hillsborough-roof-years.ts <property-id>
  const onlyId = process.argv[2];
  const targets = (properties ?? []).filter(
    (p) =>
      countyByProperty.get(p.id) === "Hillsborough" &&
      p.house_number &&
      p.street &&
      (!onlyId || p.id === onlyId)
  );
  console.log(`${targets.length} Hillsborough properties to search for roof permits.`);

  const browser = await chromium.launch();
  const page = await browser.newPage();

  let matched = 0;
  let searched = 0;
  for (const property of targets) {
    searched += 1;
    const agency = hillsboroughPermitAgency(property.city);
    const searchUrl = `https://aca-prod.accela.com/${agency}/Cap/CapHome.aspx?module=Building&TabName=Building`;
    const streetName = normalizeStreetName(property.street!);
    console.log(
      `[${searched}/${targets.length}] ${property.address} (agency=${agency}, house#=${property.house_number}, street="${streetName}")`
    );

    try {
      await page.goto(searchUrl, { waitUntil: "networkidle" });
      await page.fill("#ctl00_PlaceHolderMain_generalSearchForm_txtGSNumber_ChildControl0", property.house_number!);
      await page.fill("#ctl00_PlaceHolderMain_generalSearchForm_txtGSStreetName", streetName);
      const startDate = page.locator("#ctl00_PlaceHolderMain_generalSearchForm_txtGSStartDate");
      await startDate.click();
      // Tampa's instance pre-fills this field (unlike Pinellas's blank one),
      // so a plain click+type inserts into the existing text rather than
      // replacing it — confirmed live ("10/11/201/01/19..." resulted without
      // this). Select-all first so this works on both agencies.
      await startDate.press("Control+A");
      await startDate.pressSequentially(EARLIEST_START_DATE, { delay: 30 });
      await page.keyboard.press("Tab");

      await page.click("#ctl00_PlaceHolderMain_btnNewSearch");
      await page.waitForLoadState("networkidle");
      // Same defensive poll as scripts/backfill-roof-years.ts: the grid (or
      // "no results" notice) can still be mid-render right after networkidle
      // fires on this ASP.NET postback.
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
