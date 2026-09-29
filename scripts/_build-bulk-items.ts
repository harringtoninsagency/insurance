import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fetchQuotingAdapter } from "@/lib/adapters/fetch-quoting";
import type { Database } from "@/lib/types/database";

type PropertyRow = Database["public"]["Tables"]["properties"]["Row"];

const candidates: PropertyRow[] = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "_quote-candidates.json"), "utf-8")
);

const items: Array<{
  client_item_id: string;
  fields: Record<string, string>;
  form_types?: string[];
  carrier_keys?: string[];
}> = [];

for (const property of candidates) {
  items.push({
    client_item_id: property.id,
    fields: fetchQuotingAdapter.buildQuoteFields(property),
  });
  items.push({
    client_item_id: `upc-dp3-${property.id.slice(0, 8)}`,
    fields: fetchQuotingAdapter.buildQuoteFields(property, "universal-p-c", "dp3"),
    form_types: ["dp3"],
    carrier_keys: ["universal-p-c"],
  });
}

const BATCH_SIZE_PROPERTIES = 25; // 25 properties = 50 items per batch file
const propertyBatches: PropertyRow[][] = [];
for (let i = 0; i < candidates.length; i += BATCH_SIZE_PROPERTIES) {
  propertyBatches.push(candidates.slice(i, i + BATCH_SIZE_PROPERTIES));
}

let itemOffset = 0;
propertyBatches.forEach((batch, batchIndex) => {
  const batchItems = items.slice(itemOffset, itemOffset + batch.length * 2);
  itemOffset += batch.length * 2;
  writeFileSync(
    resolve(import.meta.dirname, `_bulk-batch-${batchIndex}.json`),
    JSON.stringify(batchItems)
  );
  console.log(`Batch ${batchIndex}: ${batchItems.length} items (${batch.length} properties)`);
});

console.log(`Built ${items.length} items for ${candidates.length} properties across ${propertyBatches.length} batch files.`);
