import { resolve } from "node:path";
process.loadEnvFile(resolve(import.meta.dirname, "../.env.local"));
import { createServiceSupabase } from "@/lib/supabase/server";
import { fetchQuotingAdapter } from "@/lib/adapters/fetch-quoting";

const supabase = createServiceSupabase();

const ids = [
  "27bd3789-5a25-4336-9f6a-6b817acbb198",
  "d02abf70-6f0b-476c-b4ac-aa84a0674f7d",
  "55b0c9de-211a-4c5b-bf5e-d308b4581da6",
  "2af3307c-ba4f-4970-8ae7-98aaa422507c",
  "02c28513-75a5-4047-b887-dbf78e236366",
  "74b481ee-c429-4b8f-83f9-5585cc23ee51",
  "b86e74f8-b024-4f60-8386-4b36e9befe9c",
  "5713cdf6-21fe-46d9-a5bf-d387f0f80126",
  "e5db1070-394f-4f3a-a875-c07d3ad57a53",
  "f72f9443-bf41-43e7-a13f-01f7e5c45414",
  "bed78930-ca96-4c97-a79d-be9b95741f80",
  "420328a1-c461-4a6c-99f0-c91e991d436d",
  "a97b67f5-d80c-446f-b358-d72e759491c0",
];

async function main() {
  const { data: props, error } = await supabase.from("properties").select("*").in("id", ids);
  if (error) throw error;
  if ((props?.length ?? 0) !== ids.length) {
    console.error(`Expected ${ids.length} properties, got ${props?.length ?? 0}`);
  }

  const items: Array<{ client_item_id: string; fields: Record<string, string>; form_types?: string[]; carrier_keys?: string[] }> = [];
  for (const property of props ?? []) {
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
  console.log(JSON.stringify(items));
}

main();
