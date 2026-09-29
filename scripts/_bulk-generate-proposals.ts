import { resolve } from "node:path";
import { readFileSync } from "node:fs";

process.loadEnvFile(resolve(import.meta.dirname, "../.env.local"));

interface Property {
  id: string;
  address?: string;
  [key: string]: unknown;
}

const candidatesPath = resolve(import.meta.dirname, "_quote-candidates.json");
const candidates: Property[] = JSON.parse(readFileSync(candidatesPath, "utf8"));

const NO_PRICED_QUOTES_MARKER = "no priced quotes to build a proposal from";

async function main() {
  const { generateIndicationProposal } = await import("../lib/proposals/generate-indication");

  let generated = 0;
  let skipped = 0;
  let errored = 0;
  const skippedList: { propertyId: string; address?: string }[] = [];
  const errorList: { propertyId: string; address?: string; error: string }[] = [];

  for (const property of candidates) {
    const propertyId = property.id;
    try {
      await generateIndicationProposal(propertyId);
      generated++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes(NO_PRICED_QUOTES_MARKER)) {
        skipped++;
        skippedList.push({ propertyId, address: property.address });
      } else {
        errored++;
        errorList.push({ propertyId, address: property.address, error: message });
      }
    }
  }

  console.log(
    JSON.stringify(
      {
        generated,
        skipped,
        errored,
        skippedList,
        errorList,
      },
      null,
      2
    )
  );
}

main();
