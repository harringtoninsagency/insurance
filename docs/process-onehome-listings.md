# Processing the daily OneHome listing email

Run this whenever asked to "process the OneHome listing email," and it's what the scheduled daily routine
follows unattended. Self-contained — assumes no prior context about this session's conversation history.

## Why this exists

OneHome sends a daily saved-search digest email (to a Gmail inbox) highlighting new or updated listings, each
with a thumbnail photo. Parsing that email and matching listings to county records already happens without an
agent (`lib/ingest/onehome-email.ts`, `lib/ingest/apply-onehome-listings.ts`,
`lib/ingest/apply-onehome-photos.ts`, `lib/enrichment/apply-county-enrichment.ts`) — this procedure is the
remaining half: Fetch's carrier-quoting tools only exist inside an authenticated Claude Code session (this one,
or a scheduled routine with the Fetch MCP connector attached), never as a plain server API, so quoting each
newly-ingested listing needs an agent. **Generate-and-store only** — this never sends or emails anything to
anyone; a producer reviews and sends each listing snapshot by hand once it's generated.

## Repo

`https://github.com/harringtoninsagency/insurance`, branch `main`. Agency id: `ccb0a58e-0b78-4799-b236-66d1bda42f67`.

## Credentials — read this before step 1

Every script below starts with `import { loadEnvIfPresent } from "@/lib/env"; loadEnvIfPresent();`. This
routine needs FIVE variables as real process environment variables (already set on the environment before this
process starts): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
`GMAIL_IMAP_USER`, `GMAIL_IMAP_APP_PASSWORD`.

**Check first**, before running anything else: `env | grep -iE "supabase|gmail"`. If any of the five aren't
there, that's an environment configuration problem — stop, send exactly one push notification naming the
missing variables, and end the run. Do not work around it by writing a `.env.local` file, asking for the values
in chat, or any other substitute; those values must only ever be set directly in this environment's own
settings.

## Browser — this environment's setup script must install a system Chromium

Step 1b (the portal scrape) needs a real browser. Playwright's own `npx playwright install chromium` downloads
one from `cdn.playwright.dev` — confirmed live, repeatedly, that this cloud sandbox blocks that host outright
(`Host not in allowlist`), unlike a specific SaaS API host such as Supabase's. Adding `cdn.playwright.dev` to
the network allowlist did not fix it even after repeated confirmed attempts — treat that path as a dead end,
not something to keep retrying.

The environment's setup script instead installs Chromium via `apt` (already proven to work in this sandbox —
other apt packages install fine there):

```
cd insurance && npm install && apt-get install -y chromium
```

Then set `CHROMIUM_EXECUTABLE_PATH` as a real environment variable/credential in the environment's settings
(the same place `GMAIL_IMAP_USER` etc. live), value `/usr/bin/chromium` — **not** via `export`/`~/.bashrc` in
the setup script. A setup-script `export` doesn't reliably reach the separate process Claude Code later starts
from (same class of bug as the `NODE_USE_ENV_PROXY` issue documented in
`docs/process-quote-requests.md` — a value only set mid-script, in one process, isn't guaranteed to be present
in a different process started afterward). A real environment-level variable is the only thing that's
consistently worked for cross-process values in this sandbox.

If a run ever shows a browser-launch error (not the Incapsula/bot-detection kind — an actual "executable not
found" or similar), check first whether `CHROMIUM_EXECUTABLE_PATH` is set and whether `apt-get install -y
chromium` actually succeeded in the setup script log before assuming the code is wrong — this has been the
single most failure-prone part of this whole pipeline to get right in the cloud environment.

**Always run every script below as:**

```
NODE_USE_ENV_PROXY=1 npx tsx scripts/_yourscript.mts
```

Never bare `npx tsx ...`, and never a `.ts` extension (these use top-level await, which needs `.mts`). See
`docs/process-quote-requests.md`'s Credentials section for the full explanation of why the proxy flag is
required and why setting it from inside a script doesn't work — same cloud sandbox, same fix.

## Steps

### 1. Fetch and parse the email

```ts
// scripts/_fetch-onehome.mts (scratch — delete when done)
import { loadEnvIfPresent } from "@/lib/env";
loadEnvIfPresent();
import { fetchRecentGmailBodies } from "@/lib/ingest/gmail-mail";
import { parseOneHomeListingsFromHtml, extractListingPhotos } from "@/lib/ingest/onehome-email";

const LOOKBACK_HOURS = 36; // wider than the daily cadence so a missed run doesn't drop a day's listings
const messages = await fetchRecentGmailBodies(LOOKBACK_HOURS);
const allListings = [];
const allPhotos = [];
for (const m of messages) {
  const listings = parseOneHomeListingsFromHtml(m.bodyHtml);
  if (listings.length === 0) continue;
  allListings.push(...listings);
  allPhotos.push(...extractListingPhotos(m.bodyHtml));
}
console.log(JSON.stringify({ listingCount: allListings.length, photoCount: allPhotos.length, allListings, allPhotos }, null, 1));
```

### 1b. Also pull the full portal backlog (optional, but recommended)

The email only inlines ~10-25 "Highlights" listings. The saved search's actual full result set (all current
matches, often 100+) is one click away via the email's "View All Properties"/"N new or updated listings" link,
and `lib/ingest/onehome-portal.ts` can pull the whole thing — same `ParsedListing` shape, plus photos, no
duplicate code path to maintain against `apply-onehome-listings.ts`/`apply-onehome-photos.ts`.

```ts
// scripts/_fetch-portal.mts (scratch)
import { loadEnvIfPresent } from "@/lib/env";
loadEnvIfPresent();
import { extractPortalUrl, scrapePortalListings } from "@/lib/ingest/onehome-portal";

const digestHtml = /* the "Pinellas homes for sale" message's bodyHtml from step 1 */ "";
const portalUrl = extractPortalUrl(digestHtml);
if (portalUrl) {
  const { listings, photos } = await scrapePortalListings(portalUrl);
  // merge into allListings/allPhotos from step 1 — applyOneHomeListings/applyOneHomePhotos
  // are upsert-safe, so simply concatenating and letting duplicates (same mlsId) collide is fine.
}
```

This needs a real browser (Playwright, headless Chromium) — the portal page sits behind Incapsula
bot-detection and returns only an empty shell to a plain HTTP request (confirmed live). Headless Chromium does
get through it reliably (confirmed live, repeatedly), but this is inherently less certain to keep working than
the official bulk-data channels this project otherwise relies on (PCPAO, Pasco, DOR) — if a future run can't
find any listings at all where it previously could, bot-detection catching up with headless Chromium is the
most likely explanation, not a parsing bug. Don't try to "fix" that by changing user agents, adding stealth
plugins, or similar — stop and notify, same as any other hard blocker.

**Photos work on both sources, from different CDNs** — the email's `extractListingPhotos` reads
`media.stellar.mlsmatrix.com` URLs; the portal's `extractPortalPhotos` reads `api.cotality.com` URLs (confirmed
live: 102/102 listings matched to a photo in one real run, real downloadable JPEGs). Portal photo URLs carry a
short-lived signed token (~30 minute expiry observed) — download them promptly via `applyOneHomePhotos`, not
hours later.

**Use `parseOneHomeListingsFromHtml`, not `parseOneHomeListingsFromText`, for Gmail-sourced messages.** Gmail
(via IMAP) doesn't server-side-convert HTML to a clean plain-text layout the way Microsoft Graph did for the
Outlook mailbox this was originally built against — a Gmail message's "plain text" body can just be the raw
HTML source with tags stripped, which the text-based block regex never matches. Confirmed live: the real daily
digest ("Pinellas homes for sale") parsed 0 listings from `bodyText` and 10 from `bodyHtml`, both with correct,
verified data (price/address/city/zip/beds/baths/sqft), paired 1:1 with `extractListingPhotos`' 10 photos in
the same order.

If `listingCount` is 0, stop — nothing to do (no OneHome email in the lookback window, or it had no
highlighted listings).

### 2. Upsert listings and attach photos

```ts
// scripts/_apply-onehome.mts (scratch)
import { loadEnvIfPresent } from "@/lib/env";
loadEnvIfPresent();
import { applyOneHomeListings } from "@/lib/ingest/apply-onehome-listings";
import { applyOneHomePhotos } from "@/lib/ingest/apply-onehome-photos";

const AGENCY_ID = "ccb0a58e-0b78-4799-b236-66d1bda42f67";
const allListings = [ /* from step 1 */ ];
const allPhotos = [ /* from step 1 */ ];

const listingResult = await applyOneHomeListings(AGENCY_ID, allListings);
const photoResult = await applyOneHomePhotos(AGENCY_ID, allPhotos);
console.log(JSON.stringify({ listingResult, photoResult }, null, 1));
```

Upserts are keyed on `(agency_id, mls_id)` — safe to re-run on the same listing across multiple days without
duplicating it. A photo never overwrites one already on file (see the function's own doc comment).

### 3. Enrich and find what's newly quotable

```ts
// scripts/_find-quotable.mts (scratch)
import { loadEnvIfPresent } from "@/lib/env";
loadEnvIfPresent();
import { createServiceSupabase } from "@/lib/supabase/server";
import { applyCountyEnrichment } from "@/lib/enrichment/apply-county-enrichment";

const AGENCY_ID = "ccb0a58e-0b78-4799-b236-66d1bda42f67";
const mlsIds = [ /* from step 1's allListings, mapped to .mlsId */ ];
const s = createServiceSupabase();
const { data: touched } = await s.from("properties").select("id, mls_id, status, year_built, sqft").eq("agency_id", AGENCY_ID).in("mls_id", mlsIds);

for (const p of touched ?? []) {
  if (p.status === "new") await applyCountyEnrichment(p.id);
}

// Re-fetch after enrichment, then filter to what's actually quotable and not already done.
const { data: refreshed } = await s.from("properties").select("id, mls_id, address, status, year_built, sqft").eq("agency_id", AGENCY_ID).in("mls_id", mlsIds);
const quotable = (refreshed ?? []).filter((p) => p.year_built && p.sqft && p.status !== "quoted" && p.status !== "closed" && p.status !== "dead");
console.log(JSON.stringify(quotable, null, 1));
```

`status = 'quoted'` means a previous run already generated a listing snapshot for it — **skip these**, don't
re-quote (OneHome's digest repeats the same "highlighted" listings across several days). A property missing
`year_built`/`sqft` couldn't be matched to county records — skip it too; that needs a producer to fill in by
hand, same as a `needs_review` quote request.

### 4. For each quotable property, quote and finalize

Same as `docs/process-quote-requests.md` steps 2-5, with two differences: build items from the property
directly (no `quote_requests` row to read coverage overrides from — use defaults, i.e. omit the coverage
argument), and finalize with `finalizeOneHomeListing` instead of `finalizeQuoteRequest`:

```ts
// scripts/_build-items.mts (scratch)
import { loadEnvIfPresent } from "@/lib/env";
loadEnvIfPresent();
import { createServiceSupabase } from "@/lib/supabase/server";
import { buildFetchQuoteItems } from "@/lib/quote-requests/fetch-pipeline";
const s = createServiceSupabase();
const PROPERTY_ID = "..."; // fill in, one per quotable property from step 3
const { data: property } = await s.from("properties").select("*").eq("id", PROPERTY_ID).single();
const items = buildFetchQuoteItems(property!, {}, PROPERTY_ID);
console.log(JSON.stringify(items));
```

Use the **property id itself** as `runSuffix` (same reasoning as the quote-request procedure: Fetch dedupes on
`client_item_id`, and a fresh id per property avoids ever returning stale results across different properties
or days).

Submit to Fetch (`CreateBulkQuoteRequest`, poll `GetBulkQuoteStatus`, `GetQuoteStatus(include_rates: true)`,
`mergeFetchRates`) exactly as documented there — identical mechanics, just a different property source.

```ts
// scripts/_finalize.mts (scratch)
import { loadEnvIfPresent } from "@/lib/env";
loadEnvIfPresent();
import { finalizeOneHomeListing } from "@/lib/onehome/finalize-listing";
const result = await finalizeOneHomeListing(PROPERTY_ID, STANDARD_FETCH_QUOTE_REQUEST_ID, mergedRates);
console.log(JSON.stringify(result));
```

This saves the rates, generates the listing snapshot PDF (photo included automatically if one was attached in
step 2), and marks the property `quoted`. It does **not** send or email anything — that's a deliberate,
permanent property of this pipeline, not something to "helpfully" add.

### 5. Clean up and report

Delete every scratch script created in this run. Summarize what was processed: how many listings were parsed,
how many photos attached, how many properties were newly quoted (address + carrier count), and anything that
ended up skipped (already quoted, missing county match) or failed and why.

## Notes for whoever (or whatever) runs this

- Never auto-send or auto-email a generated proposal. If a future request asks for that, it needs an explicit,
  separate decision — don't infer it from "run autonomously," which describes the quoting and PDF generation
  only.
- Each property gets its own quote — never reuse another property's Fetch quote_request_id.
- If Fetch returns zero usable rates, `finalizeOneHomeListing` returns `status: "failed"` with a reason rather
  than silently producing an empty proposal or marking it `quoted` — that's expected behavior, not a bug to fix.
- This procedure is idempotent per property as long as a fresh `runSuffix` is used and `status` is checked
  first (step 3 already does this) — a property already at `quoted` should never be re-submitted to Fetch.
