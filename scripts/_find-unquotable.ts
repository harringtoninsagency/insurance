import { resolve } from "node:path";
import { readFileSync } from "node:fs";

process.loadEnvFile(resolve(import.meta.dirname, "../.env.local"));

interface Property {
  id: string;
  [key: string]: unknown;
}

const candidatesPath = resolve(import.meta.dirname, "_quote-candidates.json");
const candidates: Property[] = JSON.parse(readFileSync(candidatesPath, "utf8"));
const candidateIds = new Set(candidates.map((p) => p.id));

const AGENCY_ID = "ccb0a58e-0b78-4799-b236-66d1bda42f67";

async function main() {
  const { createServiceSupabase } = await import("@/lib/supabase/server");
  const supabase = createServiceSupabase();

  const { data: properties, error } = await supabase
    .from("properties")
    .select("*")
    .eq("agency_id", AGENCY_ID)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Failed to query properties: ${error.message}`);

  const fields = ["house_number", "street", "city", "zipcode", "year_built", "sqft"] as const;

  const unquotable = (properties ?? [])
    .filter((p) => !candidateIds.has(p.id))
    .map((p) => {
      const missing = fields.filter((f) => p[f] === null || p[f] === undefined || p[f] === "");
      return { property: p, missing };
    })
    .filter((entry) => entry.missing.length > 0);

  const output = unquotable.map((entry) => ({
    id: entry.property.id,
    address: [entry.property.house_number, entry.property.street, entry.property.city, entry.property.zipcode]
      .filter(Boolean)
      .join(" "),
    missing: entry.missing,
    created_at: entry.property.created_at,
  }));

  console.log(JSON.stringify({ count: output.length, properties: output }, null, 2));
}

main();
