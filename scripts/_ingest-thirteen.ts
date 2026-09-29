import { resolve } from "node:path";
import { readFileSync } from "node:fs";

process.loadEnvFile(resolve(import.meta.dirname, "../.env.local"));

// Data assembled from bulk_id 6aa3e4420b58894781049ed5 (13 re-enriched Pinellas
// properties that previously failed to quote due to county-parcel matching
// bugs, now fixed). For each property: standard multi-carrier rates with the
// bogus Universal P&C DP3 placeholder (~$128, "Coverage is unavailable")
// dropped, and the real Universal P&C DP3 rate (from the upc-dp3-<id> override
// item, which uses Tenant/Rental occupancy so Universal P&C actually prices
// it) merged in.
interface MergedRate {
  id: string;
  carrier: string;
  form_type: string;
  status: string;
  premium: string | null;
  request_id: string;
}

interface PropertyEntry {
  address: string;
  standard_quote_request_id: string;
  dropped_universal_dp3: boolean;
  rate_count: number;
  rates: MergedRate[];
}

const dataPath = resolve(import.meta.dirname, "_merged-quotes-thirteen.json");
const data: Record<string, PropertyEntry> = JSON.parse(readFileSync(dataPath, "utf8"));

async function main() {
  const { ingestFetchQuoteResults } = await import("../lib/quotes/ingest");
  const { generateIndicationProposal } = await import("../lib/proposals/generate-indication");

  let propertiesIngested = 0;
  let totalRows = 0;
  const ingestErrors: { propertyId: string; address: string; error: string }[] = [];

  let proposalsGenerated = 0;
  let proposalsSkipped = 0;
  const proposalErrors: { propertyId: string; address: string; error: string }[] = [];
  const skippedList: { propertyId: string; address: string }[] = [];

  const NO_PRICED_QUOTES_MARKER = "no priced quotes to build a proposal from";

  for (const [propertyId, entry] of Object.entries(data)) {
    if (!entry.dropped_universal_dp3) {
      console.warn(`WARNING: ${propertyId} (${entry.address}) did not have a Universal P&C DP3 rate to drop`);
    }
    try {
      const inserted = await ingestFetchQuoteResults(
        propertyId,
        entry.standard_quote_request_id,
        entry.rates
      );
      propertiesIngested++;
      totalRows += inserted?.length ?? 0;
    } catch (err) {
      ingestErrors.push({
        propertyId,
        address: entry.address,
        error: err instanceof Error ? err.message : String(err),
      });
      continue; // don't attempt a proposal if ingest failed
    }

    try {
      await generateIndicationProposal(propertyId);
      proposalsGenerated++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes(NO_PRICED_QUOTES_MARKER)) {
        proposalsSkipped++;
        skippedList.push({ propertyId, address: entry.address });
      } else {
        proposalErrors.push({ propertyId, address: entry.address, error: message });
      }
    }
  }

  console.log(
    JSON.stringify(
      {
        totalProperties: Object.keys(data).length,
        propertiesIngested,
        totalQuoteRows: totalRows,
        ingestErrors,
        proposalsGenerated,
        proposalsSkipped,
        skippedList,
        proposalErrors,
      },
      null,
      2
    )
  );
}

main();
