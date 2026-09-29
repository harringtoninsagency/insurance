# Processing pending quote requests

Run this whenever asked to "process the quote request queue," and it's what the scheduled hourly routine
follows unattended. Self-contained — assumes no prior context about this session's conversation history.

## Why this exists

Fetch's carrier-quoting tools (`CreateBulkQuoteRequest`, `GetBulkQuoteStatus`, `GetQuoteStatus`) only exist
inside an authenticated Claude Code session with the Fetch MCP connector attached — there is no plain REST API
key the deployed app itself can call. Property matching and county enrichment already happen automatically the
instant someone submits a request (`lib/quote-requests/prepare.ts`) — this procedure is the remaining half, the
part that needs an agent.

## Repo

`https://github.com/harringtoninsagency/insurance`, branch `main`. Agency id: `ccb0a58e-0b78-4799-b236-66d1bda42f67`.

## Credentials — read this before step 1

Every script below starts with `import { loadEnvIfPresent } from "@/lib/env"; loadEnvIfPresent();`. On a local
machine `.env.local` exists and this loads it. In this routine's cloud environment there is no such file — the
three Supabase variables (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`) are meant to be provided directly as real process environment variables instead,
already set on the environment before this process starts — `loadEnvIfPresent()` does nothing in that case,
which is correct (calling `process.loadEnvFile` on a path that doesn't exist throws).

**Check first**, before running anything else: `env | grep -i supabase`. If the three variables aren't there,
that's an environment configuration problem — stop, send exactly one push notification naming the missing
variables, and end the run. Do not work around it by writing a `.env.local` file, asking for the values in
chat, or any other substitute; those values must only ever be set directly in this environment's own settings.

**Always run every script below (every step that touches Supabase) as:**

```
NODE_USE_ENV_PROXY=1 npx tsx scripts/_yourscript.mts
```

Never bare `npx tsx ...` in this environment. Without that prefix, a Supabase call fails with `Host not in
allowlist: ustvvbyvvnglsgovkgkh.supabase.co` — this environment's egress proxy (HTTPS_PROXY/https_proxy) is
required, and Node's fetch only honors it when `NODE_USE_ENV_PROXY=1` is a real process environment variable
*before Node starts*. Setting `process.env.NODE_USE_ENV_PROXY` from inside a script does NOT work — confirmed
live, twice — because ES module imports (including `@supabase/supabase-js`, which initializes its own
fetch/undici dispatcher as a side effect of being imported) are evaluated before any top-level statement in the
importing file runs, so by the time such a line would execute, it's already too late. The prefix must be on the
shell command that starts the `node`/`tsx` process itself.

If a Supabase call still fails with that same error even with the prefix, the proxy's own allowlist is the real
problem — stop and notify, same as a missing-variable failure, rather than retrying workarounds.

## Steps

### 1. Find pending requests

```ts
// scripts/_find-pending.mts (scratch — delete when done; .mts, not .ts — these use top-level await)
import { loadEnvIfPresent } from "@/lib/env";
loadEnvIfPresent();
import { createServiceSupabase } from "@/lib/supabase/server";
const s = createServiceSupabase();
const { data } = await s.from("quote_requests").select("id, property_id, address_line, city, request_kind, dwelling_a, personal_property_pct").eq("status", "processing").order("created_at");
console.log(JSON.stringify(data, null, 1));
```

`status = 'processing'` means it's already matched to a property with enough data to quote (set automatically
at submission — see `lib/quote-requests/prepare.ts`). `status = 'needs_review'` means it couldn't be matched
automatically and needs a producer to add property details by hand first (check `/quote-requests` in the app,
or `status_detail` on the row) — skip those here.

If there are none, stop — nothing to do.

### 2. For each pending request, build the Fetch items

```ts
// scripts/_build-items.mts (scratch; .mts, not .ts)
import { loadEnvIfPresent } from "@/lib/env";
loadEnvIfPresent();
import { createServiceSupabase } from "@/lib/supabase/server";
import { buildFetchQuoteItems } from "@/lib/quote-requests/fetch-pipeline";
const s = createServiceSupabase();
const REQUEST_ID = "..."; // fill in
const { data: request } = await s.from("quote_requests").select("*").eq("id", REQUEST_ID).single();
const { data: property } = await s.from("properties").select("*").eq("id", request!.property_id!).single();
const items = buildFetchQuoteItems(property!, { dwellingA: request!.dwelling_a, personalPropertyPct: request!.personal_property_pct }, REQUEST_ID);
console.log(JSON.stringify(items));
```

Use the **quote_requests id itself** as `runSuffix` — guaranteed unique per request, and avoids Fetch's
client_item_id dedupe (a repeated id silently returns OLD results instead of re-quoting).

### 3. Submit to Fetch

Call `CreateBulkQuoteRequest` (`product_code: "home"`) with the two items from step 2. Poll
`GetBulkQuoteStatus` (with `include_items: true, item_status: "submitted"`) every ~15-20 seconds until
`rates_done: true` for both items — this typically takes 30-90 seconds. Note the two `quote_request_id`s
Fetch returns (one per item: the standard item, and the `upc-dp3-...` override item).

### 4. Get full rates and merge

Call `GetQuoteStatus(quote_request_id, include_rates: true)` for both Fetch quote_request_ids. Then:

```ts
// scripts/_merge.mts (scratch; .mts, not .ts)
import { mergeFetchRates, type RawFetchRate } from "@/lib/quote-requests/fetch-pipeline";
const standardRates: RawFetchRate[] = [...]; // paste from GetQuoteStatus's `rates` array — keep id, carrier, form_type, status, premium, carrier_response_messages
const overrideRates: RawFetchRate[] = [...];
console.log(JSON.stringify(mergeFetchRates(standardRates, overrideRates)));
```

`mergeFetchRates` already handles everything that used to be manual judgment calls: drops declined/errored
rates, HO8/DP1 forms, $0 or null-premium "success" rows, any rate carrying a real underwriting warning in
`carrier_response_messages` even alongside a priced premium (e.g. "Year of construction is ineligible",
"Property age exceeds maximum"), and the standard item's own Universal P&C DP3 row (always a $128
placeholder), replacing it with the override item's real DP3 rate.

### 5. Finalize

```ts
// scripts/_finalize.mts (scratch; .mts, not .ts)
import { loadEnvIfPresent } from "@/lib/env";
loadEnvIfPresent();
import { finalizeQuoteRequest } from "@/lib/quote-requests/fetch-pipeline";
const result = await finalizeQuoteRequest(REQUEST_ID, STANDARD_FETCH_QUOTE_REQUEST_ID, mergedRates);
console.log(JSON.stringify(result));
```

This saves the rates, generates whichever proposal(s) `request_kind` asked for (crediting the referring
partner automatically when the request came through the portal — see `lib/quote-requests/referral-partner.ts`),
and marks the request `completed` (or `failed` with a reason, if nothing priced or PDF generation errored).

### 6. Clean up and report

Delete every scratch script created in this run. Summarize what was processed: address, carriers/premiums
saved, proposal kind(s) generated, and anything that ended up `needs_review` or `failed` and why.

## Notes for whoever (or whatever) runs this

- Each property gets its own quote — never reuse another request's Fetch quote_request_id.
- If Fetch returns zero usable rates for a property, `finalizeQuoteRequest` marks it `failed` with a clear
  reason rather than silently producing an empty proposal — that's expected behavior, not a bug to fix.
- This procedure is idempotent per request as long as a fresh `runSuffix` (the request id) is used each time
  it's actually run — but don't call it twice for the same request without a reason; check `status` first.
