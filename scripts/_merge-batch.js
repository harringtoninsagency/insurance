// Usage: node scripts/_merge-batch.js scripts/_raw-batch-NN.json
// Merges a raw batch of {quote_request_id, rates} into _quote-results.json,
// joining client_item_id from _all-quote-requests.json, and removes the
// now-done ids from _remaining-ids.json. Deletes the raw batch file after merge.
const fs = require("fs");
const path = require("path");

const rawPath = process.argv[2];
if (!rawPath) {
  console.error("Usage: node scripts/_merge-batch.js <raw-batch-file>");
  process.exit(1);
}

const scriptsDir = path.join(__dirname);
const resultsPath = path.join(scriptsDir, "_quote-results.json");
const remainingPath = path.join(scriptsDir, "_remaining-ids.json");
const allReqPath = path.join(scriptsDir, "_all-quote-requests.json");

const raw = JSON.parse(fs.readFileSync(rawPath, "utf8"));
const results = JSON.parse(fs.readFileSync(resultsPath, "utf8"));
const remaining = JSON.parse(fs.readFileSync(remainingPath, "utf8"));
const allReq = JSON.parse(fs.readFileSync(allReqPath, "utf8"));

const byQrid = new Map(allReq.map((r) => [r.quote_request_id, r.client_item_id]));
const existingQrids = new Set(results.map((r) => r.quote_request_id));

let added = 0;
let skippedDup = 0;
let missingJoin = 0;

for (const entry of raw) {
  const qrid = entry.quote_request_id;
  if (existingQrids.has(qrid)) {
    skippedDup++;
    continue;
  }
  const clientItemId = byQrid.get(qrid);
  if (!clientItemId) {
    missingJoin++;
    console.error("No client_item_id found for quote_request_id", qrid);
    continue;
  }
  results.push({ client_item_id: clientItemId, quote_request_id: qrid, rates: entry.rates });
  existingQrids.add(qrid);
  added++;
}

const remainingSet = new Set(remaining);
for (const entry of raw) {
  remainingSet.delete(entry.quote_request_id);
}
const newRemaining = [...remainingSet];

fs.writeFileSync(resultsPath, JSON.stringify(results));
fs.writeFileSync(remainingPath, JSON.stringify(newRemaining));
fs.unlinkSync(rawPath);

console.log(
  JSON.stringify({
    added,
    skippedDup,
    missingJoin,
    totalResults: results.length,
    remainingCount: newRemaining.length,
  })
);
