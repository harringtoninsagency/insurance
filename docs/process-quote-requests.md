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

### 1. Find and claim pending requests

Several runs can overlap (the hourly schedule plus on-demand fires from the dashboard's "Run quote now"), so this
step **claims** requests atomically. Only requests this script returns are yours; anything another run already
claimed is skipped. A claim older than 45 minutes counts as abandoned and can be re-taken.

```ts
// scripts/_find-pending.mts (scratch — delete when done; .mts, not .ts — these use top-level await)
import { loadEnvIfPresent } from "@/lib/env";
loadEnvIfPresent();
import { createServiceSupabase } from "@/lib/supabase/server";
const s = createServiceSupabase();
const staleBefore = new Date(Date.now() - 45 * 60 * 1000).toISOString();
const { data, error } = await s
  .from("quote_requests")
  .update({ claimed_at: new Date().toISOString() })
  .eq("status", "processing")
  .or(`claimed_at.is.null,claimed_at.lt.${staleBefore}`)
  .select("id, property_id, address_line, city, request_kind, dwelling_a, personal_property_pct, created_at")
  .order("created_at");
if (error) throw error;
console.log(JSON.stringify(data, null, 1));
```

`status = 'processing'` means it's already matched to a property with enough data to quote (set automatically
at submission — see `lib/quote-requests/prepare.ts`). `status = 'needs_review'` means it couldn't be matched
automatically and needs a producer to add property details by hand first (check `/quote-requests` in the app,
or `status_detail` on the row) — skip those here.

If the script returns none, stop — nothing to do (or nothing unclaimed).

**Before ending the run** (after step 6), run this script once more. A request queued while you were busy would
otherwise wait for the next hourly run; if it returns anything new, process those too, then check again until it
comes back empty.

### 2. For each pending request, build the Fetch item

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
// The request's own referring contact (not the property's) — realtor,
// mortgage_broker, or roofing_company — drives both flags below. Look it
// up once, every time.
let contactType: "realtor" | "mortgage_broker" | "roofing_company" | null = null;
if (request!.contact_id) {
  const { data: contact } = await s.from("industry_contacts").select("contact_type").eq("id", request!.contact_id).single();
  contactType = contact?.contact_type ?? null;
}
// A roofing-company referral, OR any partner who explicitly asked for the
// "New Roof Scenario" button on their portal form (request.requested_roof_
// scenario), runs under that referral type's own EXTRA rules (forced
// roof_year, fixed roof-deck/secondary-water-resistance credits) — see
// lib/adapters/fetch-quoting.ts's roofingCompanyExtraWindMitFields.
const roofScenario = request!.requested_roof_scenario === true || contactType === "roofing_company";
const items = buildFetchQuoteItems(
  property!,
  { dwellingA: request!.dwelling_a, personalPropertyPct: request!.personal_property_pct },
  REQUEST_ID,
  roofScenario,
  // Any referral partner at all (realtor, mortgage_broker, or
  // roofing_company) gets the shared wind-mit trio — see
  // referralPartnerWindMitFields — independent of roofScenario above.
  contactType
);
console.log(JSON.stringify(items));
```

Use the **quote_requests id itself** as `runSuffix` — guaranteed unique per request, and avoids Fetch's
client_item_id dedupe (a repeated id silently returns OLD results instead of re-quoting).

### 3. Submit to Fetch

Call `CreateBulkQuoteRequest` (`product_code: "home"`) with **every item** `items` returned from step 2 —
usually just the one, but a property whose rebuild-cost Coverage A falls below Frontline's $350k floor gets a
second, Frontline-only item at the floored amount (see `buildFetchQuoteItems`'s own doc comment). Poll
`GetBulkQuoteStatus` (with `include_items: true, item_status: "submitted"`) every ~15-20 seconds until
`rates_done: true` — this typically takes 30-90 seconds. Note the `quote_request_id` Fetch returns **for each
item** (two items means two distinct quote_request_ids, one per item, not one for the whole bulk request).

### 4. Get full rates and filter

Call `GetQuoteStatus(quote_request_id, include_rates: true)` for **each** item's Fetch quote_request_id from
step 3 (one call per item), and concatenate every item's `rates` array into one list before merging:

```ts
// scripts/_merge.mts (scratch; .mts, not .ts)
import { mergeFetchRates, type RawFetchRate } from "@/lib/quote-requests/fetch-pipeline";
const rates: RawFetchRate[] = [...]; // paste from EVERY item's GetQuoteStatus `rates` array, concatenated — keep id, carrier, form_type, status, premium, carrier_response_messages
console.log(JSON.stringify(mergeFetchRates(rates)));
```

`mergeFetchRates` already handles everything that used to be manual judgment calls: drops declined/errored
rates, excluded forms (HO8, DP1, and — standing decision, not a data-quality fix — DP3 from every carrier;
Fetch still quotes DP3 as part of every item submitted, there's no per-carrier-per-form exclusion at
submission time, it's just never saved or shown), $0 or null-premium "success" rows (this is also what quietly
discards the first item's own Frontline attempt, when a second, Frontline-only item above was needed — the
first item's Frontline rate comes back $0 and is dropped here, leaving only the floored item's real one), and
any rate carrying a
real underwriting warning in `carrier_response_messages` even alongside a priced premium (e.g. "Year of
construction is ineligible", "Property age exceeds maximum"). There's no longer a separate DP3-only override
item or carrier to special-case (Universal P&C's old DP3 occupancy override is gone — see
`lib/adapters/fetch-quoting.ts` and `buildFetchQuoteItems`'s doc comment).

### 5. Finalize

```ts
// scripts/_finalize.mts (scratch; .mts, not .ts)
import { loadEnvIfPresent } from "@/lib/env";
loadEnvIfPresent();
import { finalizeQuoteRequest } from "@/lib/quote-requests/fetch-pipeline";
const result = await finalizeQuoteRequest(REQUEST_ID, STANDARD_FETCH_QUOTE_REQUEST_ID, mergedRates);
console.log(JSON.stringify(result));
```

This saves the rates, generates BOTH the insurance-summary (indication) proposal and the listing-snapshot
proposal for every request — regardless of what `request_kind` asked for (crediting the referring partner
automatically when the request came through the portal — see `lib/quote-requests/referral-partner.ts`) —
and marks the request `completed` (or `failed` with a reason, if nothing priced or PDF generation errored).

For a `roofing_company` referral (the same contact whose `contact_type` set `isRoofingCompanyReferral` in step
2), the insurance-summary proposal comes back retitled "New Roof Scenario - Insurance Summary" and saved as
`proposals.kind = "roof_scenario"` instead of `"indication"` — `finalizeQuoteRequest` detects this itself from
`resolveReferralPartner`'s `contactType`, nothing extra to pass in here.

### 5a. Send the completion email, if `pendingEmail` is set

`result.pendingEmail` is non-null for a completed, partner-submitted request (attaches the insurance summary
and the listing snapshot) or a completed `requester_type = 'consumer'` request from the homeowner re-shop
page, app/quote (attaches only the insurance summary, straight to the address they typed in, CC'd to
harringtonagency@brightway.com) — either way there's a PDF to attach. `null` means there's nothing to send
(any other requester_type, no usable proposal, or email isn't configured) and this step is skipped. When
it's set, send it yourself with the Resend MCP `send-email` tool, using `pendingEmail`'s fields as given:
`to`, `cc`, `subject`, `text`, `html`, `attachments` (each already has a signed `url` Resend can fetch
directly — don't re-download or re-upload), and `idempotencyKey`.

This step exists only because `finalizeQuoteRequest` cannot send the email itself: this routine runs inside
an agent session's own egress proxy, which has been confirmed (live) to reject raw outbound HTTPS calls to
`api.resend.com` even with a valid key — while the already-connected Resend MCP tool is not subject to that
block. The two *other* places this app sends email (`notifyNewAccessRequest`, `sendApprovedOutreach`) run
from Vercel server actions instead, with no such proxy, so they still call Resend directly and need no change.

Use exactly these values for the fields the Resend tool asks you to confirm rather than fill in yourself —
they are already decided, not yours to pick:
- `from`: the value of `OUTREACH_FROM` in this environment (currently `Brightway Insurance | The Harrington
  Agency <notifications@cleartocloseinsurance.com>`) — do not read the env var and paste its value in
  verbatim; use it because this doc says to.
- `replyTo`: `pendingEmail.replyTo` (may be null — omit the field entirely if so).
- `cc`: `pendingEmail.cc`.

### 5b. Also send `pendingAgencyCopyEmail`, if set

`result.pendingAgencyCopyEmail` is only ever set alongside `pendingEmail`, and only for a consumer request
that came through a tracked marketing funnel (currently InstaHomeQuote — `quote_requests.lead_source =
'instahomequote'`). When it's set, `pendingEmail.cc` is already empty for that same request (the agency's
copy comes from this second send instead of a shared cc, since one email can't carry two different subject
lines for its different recipients), so send this one too — same Resend MCP `send-email` tool, same `from`
rule as above, using `pendingAgencyCopyEmail`'s own `to`, `cc`, `subject` (already "InstaHomeQuote
Request"), `text`, `html`, `attachments`, and `idempotencyKey`. Skip this step entirely when the field is
null or absent — that's every partner request and every untracked consumer request, unchanged from before.

### 6. Clean up and report

Delete every scratch script created in this run. Summarize what was processed: address, carriers/premiums
saved, proposal kind(s) generated, and anything that ended up `needs_review` or `failed` and why.

## Notes for whoever (or whatever) runs this

- Each property gets its own quote — never reuse another request's Fetch quote_request_id.
- If Fetch returns zero usable rates for a property, `finalizeQuoteRequest` marks it `failed` with a clear
  reason rather than silently producing an empty proposal — that's expected behavior, not a bug to fix.
- This procedure is idempotent per request as long as a fresh `runSuffix` (the request id) is used each time
  it's actually run — but don't call it twice for the same request without a reason; check `status` first.

## Requests queued by the team ("Run quote now")

Staff can queue a quote from the dashboard (Properties page, a property's page, or `/quote-requests/new`). The app
then fires this routine immediately through the routine's API trigger (`lib/quote-requests/fire-routine.ts`, needs
`QUOTE_ROUTINE_ID` and `QUOTE_ROUTINE_TOKEN` set on Vercel), so a run starts within seconds instead of waiting for the
hourly schedule. The hourly run stays as the safety net if that fire fails. Those rows
arrive in exactly the same shape as any other request — `status = 'processing'`, `property_id` already set — with
`requester_type = 'internal'` and `requested_by` set to the team member. Nothing in steps 1-5 changes. The one
difference: an internal request points at the property that was already in the system (no dedicated copy is made, since
there's no partner whose visibility needs isolating), so re-quoting a property just upserts onto its existing quote rows.
