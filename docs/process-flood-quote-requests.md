# Flood quoting addendum to process-quote-requests.md

**This is not a separate scheduled routine.** Flood quoting rides along
inside the same routine run, for the same claimed request, in the same
pass as the home quote — so a request's proposal is generated once, with
both the home carrier rates and the flood quote already in hand, instead of
risking a PDF that's missing the flood line because flood finished on a
different schedule.

Read [`docs/process-quote-requests.md`](./process-quote-requests.md) first —
this doc only describes the insertions into that doc's existing steps 1-5.
Nothing here changes how often or on what trigger the routine runs: it
already runs hourly plus on-demand via "Run quote now"; flood now rides
along on exactly that same cadence, for any claimed request where
`requested_flood_quote = true`.

## Why this exists

RocketFlood (`quotemanager.rocketflood.com`, branded "Rocket MGA") has no
API of any kind — not public, and not an undocumented one handed to
appointed agents either (confirmed by asking). The only way to get a rate is
to act like a user: log into the portal with the agency's account, fill in
the instant-quote form, and read the result off the results page. Like
Fetch's own quoting (which needs an agent session for a different reason —
its tools only exist inside an authenticated Claude session), this has to
run inside the same agent session already processing the request — just
using **Claude in Chrome** browser automation instead of an MCP tool call,
since RocketFlood doesn't offer one.

## Before starting — one extra check beyond process-quote-requests.md's own

RocketFlood session: this drives Chrome against a real, already-signed-in
RocketFlood login. If it isn't signed in, stop and send a push notification
asking for the session to be signed in — never type a RocketFlood password
read out of chat or an env var; only from a credential tool or an
already-authenticated browser session.

## Insertions into process-quote-requests.md's steps

### After step 1 (claim) — no change

A request is claimed exactly once, the same way, whether or not it wants a
flood quote. `requested_flood_quote` and `flood_status` just ride along on
the same row — there's no separate flood claim.

### After step 3 (Submit to Fetch) — new step 3b

For each request claimed in step 1 where `flood_status = 'processing'`
(meaning `requested_flood_quote` was true at submission *and* the request
had a complete address — city, state, zip all present — decided by
`lib/quote-requests/prepare.ts` at submission time, same moment it decides
the home quote's own `status`).

**Correction:** an earlier version of this doc said eligibility depended on
`enrichments.flood_zone` being populated. That's wrong on two counts — that
lookup only runs for Pinellas parcels today (coordinates aren't synced for
other counties yet — see `scripts/sync-pinellas-parcel-coordinates.ts`) and
can silently fail even there. It doesn't matter either way: RocketFlood
does its own flood-zone/elevation/property lookup from the address (see
step 1 below), so flood eligibility only needs a deliverable address — a
lower bar than the home quote's own `hasEnoughToQuote` (which requires a
matched county record). A property this app can't match to a county
record can still get a flood quote.

1. Using Claude in Chrome: navigate to `https://quotemanager.rocketflood.com/`
   (confirm already signed in), click into "Residential Primary," and submit
   the property address — this alone creates a RocketFlood "Application"
   (id like `RMGA358960`) and auto-populates year built, square footage,
   construction type, stories, garage, **and the flood zone / property
   elevation / flood (base) elevation under "Rocket Flood Data"** straight
   from the address, no input from us needed. Confirmed live against a real
   address (2005 Vista Pkwy, West Palm Beach) — `enrichments.flood_zone`
   turned out to be redundant here; RocketFlood does its own lookup.
2. Fill in what RocketFlood does *not* auto-fill, all required: Client
   Info (first/last name, email, phone — from `request.requester_name`/
   `requester_email`/`requester_phone`; `buildRocketFloodQuoteInput`
   currently falls back to the literal string "Homeowner" and empty
   email/phone when those are blank, e.g. an internal "Run quote now" run
   with no requester contact on file — **untested whether RocketFlood's
   form accepts an empty email/phone as valid**, since every live test so
   far supplied real values. If it doesn't, this needs an actual agency
   fallback contact before it's safe to run unattended — not decided yet),
   Building type
   (dropdown — "Single Family" for every property this pipeline handles),
   Foundation type (pill selector — "Slab" unless the property record says
   otherwise; selecting a different one, e.g. Stilts/Pilings, surfaces
   extra conditional fields like "Stairs leading to front door" that
   `buildRocketFloodQuoteInput` needs to handle if/when non-slab properties
   come through), and the 6 Underwriting yes/no questions — use the page's
   own "No for All" button, since every property this pipeline handles is
   an existing, non-mobile, non-CBRA, not-under-construction risk. Coverage
   amounts (dwelling/contents limit, deductible) default sensibly on their
   own; override only if the request specifies something else.
3. Click "Get Quotes." This returns, in seconds, a **grid of 15+ carrier
   cards** (Neptune, Bankers NFIP, MSI, Wright NFIP, CAT Coverage, Titan,
   Annex, Sterling, Beyond Floods, DUAL, more) — RocketFlood is a
   marketplace, not a single instant-quote engine. Most cards show
   `$0` with an "Alerts" badge (click it to read a plain-English decline
   reason, e.g. "This program is not available in the state of Florida");
   a priced card shows a real premium and a reference/policy number.
4. Scrape every card with `get_page_text`/`read_page`: carrier name,
   premium, reference number (when present). Discard the `$0`/declined
   cards. Keep this in memory — it gets written in step 5, alongside the
   home quote, not before.

This runs **while** Fetch's bulk quote (step 3) is polling in the
background (step 4's 30-90 second wait) — the two are independent calls
against two different systems, so there's no reason to serialize them
within a request. Across different requests in the same batch, run them
one at a time rather than in parallel, since step 3b is a real browser
session driving one shared RocketFlood login — it can't have two quotes
in flight at once the way Fetch's API can.

**Picking which carriers to keep:** render the **3 cheapest priced
carriers**, sorted ascending by premium. RocketFlood's own "Recommended"
badge is not the same thing — in the live test it marked Neptune ($933)
recommended while Bankers NFIP and Wright NFIP were both cheaper at $411
and MSI was $320 — so don't treat "Recommended" as a stand-in for ranking.
If a future request only returns 1-2 priced carriers, render however many
there are.

**Still not written:** `lib/quote-requests/rocketflood-pipeline.ts`
(`buildRocketFloodQuoteInput`, the scrape/parse logic, and the
top-3-by-premium selection) doesn't exist yet — this step describes its
intended shape, mirroring `lib/quote-requests/fetch-pipeline.ts`.

### Step 5 (Finalize) — now takes the flood result too

`finalizeQuoteRequest` gains an optional flood-results parameter — a list
(up to 3 entries, the cheapest priced carriers from step 3b), not a single
value. When present, finalize:

1. Writes one `quotes` row **per kept carrier** (so up to 3 rows, not 1):
   `carrier` set to the actual name (`"Neptune"`, `"Bankers NFIP"`,
   `"MSI"`, etc. — never the literal string "RocketFlood"), `adapter:
   "rocketflood"`, `form_type: "flood"`, `premium`, `external_rate_id`
   (the reference/policy number scraped off that carrier's card, when
   present), `is_indicative: true` (always — these are marketplace
   estimates, never bound rates), `raw_response` (that carrier's scraped
   card content, for audit). This is the same one-row-per-carrier shape
   `0030_dedupe_quotes_per_carrier_form.sql` already expects for the home
   quote's own multi-carrier rows, so no schema change is needed beyond
   migration 0040.
2. Sets `flood_status = 'completed'` or `'failed'` (with
   `flood_status_detail` set to a clear reason — e.g. every carrier
   declined, portal error, nothing priced) and `flood_processed_at =
   now()`.
3. **Includes the flood line in the same proposal-PDF generation pass** —
   this is the whole reason flood moved inline instead of running on its
   own schedule. Both `generate-indication.ts` and
   `generate-listing-snapshot.ts` now render a FLOOD INDICATIONS section —
   a row of up to 3 equal-width (1/3) cards, one per kept flood carrier,
   carrier name + premium — separate from the home quote's existing
   carrier table, sitting alongside it rather than inside it. Both
   generators split their own `quotes` query into home/flood by
   `form_type` right after the fetch, so a priced flood carrier never
   leaks into the home-only logic (the "starting indication" box, the
   cheapest-HO3 pick, the carrier table, the coverage basis) the way it
   silently could before this split existed.

A flood failure never marks the home quote `status` failed, and vice versa
— `status` and `flood_status` are independent outcomes written at the same
moment.

### Step 6 (Cleanup) — no change

## Notes specific to flood

- **This hits a real, logged-in vendor session on the home routine's own
  cadence** (hourly plus every on-demand fire) for any request with
  `requested_flood_quote = true`. Worth confirming nothing in the
  RocketFlood/RocketMGA agency agreement prohibits automated/scripted
  quoting before this goes live on that schedule unattended.
- Every flood quote is `is_indicative = true`.
- This procedure is idempotent per request the same way the home quote is —
  don't re-run step 3b for a request whose `flood_status` is already
  `'completed'` or `'failed'` without a reason.

## Still needed before this is runnable (not covered by this doc)

1. ~~`lib/quote-requests/prepare.ts`: decide `flood_status` at submission
   time.~~ **Done** — sets `flood_status` to `'processing'` when the
   request has a complete address (city/state/zip present) or
   `'needs_review'` when it doesn't, independent of the home quote's own
   `hasEnoughToQuote`/county-match outcome, per the correction above.
2. ~~`lib/quote-requests/rocketflood-pipeline.ts`~~ **Done** —
   `buildRocketFloodQuoteInput`, `selectTopFloodCarriers`,
   `finalizeFloodQuoteRequest`. Still open inside it: the empty-contact
   fallback noted in step 3b above, and `buildingType`/`foundationType`/
   underwriting answers are hardcoded assumptions (no foundation-type data
   source exists on `properties`/`enrichments` today).
3. The actual Claude-in-Chrome navigate/fill/scrape sequence (step 3b above)
   — lives in the agent session at runtime, not in checked-in code, same as
   Fetch's own quoting; nothing to write here beyond what step 3b already
   describes.
4. ~~`finalizeQuoteRequest`'s flood-results parameter, and the proposal
   template change~~ **Done** — `finalizeQuoteRequest` now takes an
   optional `floodResult` (`{ applicationId, carriers, failureReason? }`),
   finalizes it via a new `finalizeFloodIfRequested` helper (which calls
   `finalizeFloodQuoteRequest` and never lets a flood write failure bubble
   up into the home quote's own try/catch — see that helper's doc comment)
   **before** generating either proposal, so both generators see the flood
   quote rows already in `quotes` by the time they query it. Runs even
   when the home quote itself has no usable rate (early-return path) —
   home and flood stay independent outcomes all the way through. Both
   proposal generators got their FLOOD INDICATIONS section per item 3
   above. Still open: the caller that actually drives step 3b (the agent
   procedure in `docs/process-quote-requests.md`) doesn't exist yet, so
   nothing calls `finalizeQuoteRequest` with a `floodResult` today.
5. ~~A UI checkbox/flag wherever requests are submitted (partner portal,
   `/quote`, `/quote-requests/new`) to set `requested_flood_quote`~~
   **Done** — `lib/quote-requests/submit.ts`'s shared `SubmitQuoteRequestInput`
   gained `requestedFloodQuote`, written through to
   `quote_requests.requested_flood_quote` on insert. Added a checkbox to all
   three forms: the partner portal (`app/partner/(portal)/NewRequestForm.tsx`,
   independent of which of its two CTA buttons is pressed), the consumer
   re-shop page (`app/quote/QuoteForm.tsx`, also covers `/instahomequote` —
   same form/action), and the internal "Run a quote" form
   (`app/(dash)/quote-requests/new/NewQuoteForm.tsx`, next to its existing
   `roof_scenario` checkbox) — each wired through its own `actions.ts` into
   `submitQuoteRequest` (the internal form via `queueNewAddressQuote`, which
   already forwards unknown `SubmitQuoteRequestInput` fields through
   unchanged).

   The *existing*-property "Run quote now" button (`RunQuoteButton.tsx` →
   `queuePropertyQuote`) was initially left out of this list since it
   inserts straight into `quote_requests` rather than going through
   `submitQuoteRequest` — **now also done**: `queuePropertyQuote` gained its
   own `requestedFloodQuote` parameter (mirroring `roofScenario`), written
   to `requested_flood_quote` on insert; `RunQuoteButton.tsx` shows a
   matching checkbox (full, non-compact variant only — the compact one used
   in table rows stays unchanged) and `runQuoteForPropertyAction` threads it
   through. `queueNewAddressQuote`'s existing-property match path (the case
   where a typed-in address resolves to a property already in the system)
   was also fixed to forward `input.requestedFloodQuote` into that same
   `queuePropertyQuote` call — it had been silently dropping the opt-in
   there before.

   `scripts/auto-ingest-onehome.ts` — the unattended OneHome mailbox
   ingest, which also calls `queuePropertyQuote` directly — now always
   passes `requestedFloodQuote: true`. There's no person at that entry
   point to tick a checkbox, so by explicit decision every auto-ingested
   listing opts in automatically; this is a real behavior choice, not just
   plumbing, worth knowing about since it means every OneHome-sourced
   property now rides the RocketFlood session on this routine's cadence
   too, not just partner/consumer/internal-form submissions.

   Net effect for this routine: **every** path that can create or queue a
   `quote_requests` row (partner portal, consumer re-shop/InstaHomeQuote,
   internal "Run a quote" form, "Run quote now" on an existing property,
   and OneHome auto-ingest) can now set `requested_flood_quote = true`, so
   step 3b above is reachable from all of them on exactly the same hourly/
   on-demand cadence as the home quote — nothing about step 3b itself
   changes per origin.

All five items above are now done in code, and the schema dependency is
cleared too: migration `0040_rocketflood_flood_quotes.sql` has been applied
to the live Supabase project (the four `quote_requests` columns, the
`quote_requests_flood_status_check` constraint, and `'rocketflood'` added to
`quotes_adapter_check`), and `lib/types/database.ts` has been hand-patched
to match — this repo's types file is a hand-maintained lookalike of
Supabase's codegen output (with its own `QuoteAdapterName`/
`QuoteRequestStatus`-style aliases), not the raw generated file, so the
patch extends `QuoteAdapterName` with `"rocketflood"`, adds a new
`QuoteRequestFloodStatus` alias, and adds the 4 flood columns to
`quote_requests`'s `Row` type rather than overwriting the file wholesale.
Every file written against this schema in this doc's list should now
actually type-check. The one thing still open is the
RocketFlood/RocketMGA ToS question under "Notes specific to flood" above.
