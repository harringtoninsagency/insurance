import { resolve } from "node:path";
process.loadEnvFile(resolve(import.meta.dirname, "../.env.local"));
import { createServiceSupabase } from "@/lib/supabase/server";

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
  const supabase = createServiceSupabase();
  const { data: upcDp3, error: e1 } = await supabase
    .from("quotes")
    .select("property_id, carrier, form_type, premium")
    .in("property_id", ids)
    .eq("carrier", "Universal P&C")
    .eq("form_type", "DP3");
  if (e1) throw e1;
  console.log("Universal P&C DP3 rows (should all have real, non-128 premiums):");
  console.log(JSON.stringify(upcDp3, null, 2));

  const { data: props, error: e2 } = await supabase
    .from("properties")
    .select("id, address")
    .in("id", ids);
  if (e2) throw e2;

  const { data: proposals, error: e3 } = await supabase
    .from("proposals")
    .select("property_id, kind, pdf_path, version")
    .in("property_id", ids);
  if (e3) throw e3;
  console.log("Proposals:", JSON.stringify(proposals, null, 2));

  const { count } = await supabase
    .from("quotes")
    .select("id", { count: "exact", head: true })
    .in("property_id", ids);
  console.log("Total quote row count for these 13 properties:", count);
}

main();
