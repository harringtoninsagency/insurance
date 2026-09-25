# Florida realtor & mortgage broker directory — sourcing plan

Goal: build a retained, deduplicated directory of Florida realtors and mortgage brokers (name, company, cell,
office phone, email) that FetchRival can use to build referral relationships — starting in Pinellas and the
surrounding Tampa Bay counties, where the agency's quoting and enrichment already work.

The directory itself is built (section **Realtors & brokers** in the app, table `industry_contacts`). This
document is the plan for filling it.

## The core constraint: no public source has cell phones and emails

| Source | Gives you | Does not give you |
|---|---|---|
| **FL DBPR real estate licensee files** (free CSV, refreshed weekly; statewide or by county) | Name, employer/brokerage, address, county, license number, status | Phone, email (not in the documented columns) |
| **NMLS Consumer Access** (free public lookup; a paid B2B data subscription is also offered — confirm terms with NMLS) | Loan originators and mortgage companies, license status, employer/sponsor | Reliable direct cell/email for individuals |
| Brokerage team pages, association directories | Often an office line and email per agent | Cell phones (usually) |
| Listing data we already handle (OneHome emails, the listing-agent form) | Listing agent name, and email/phone when a producer enters them | Anything for agents who haven't listed a property we saw |

So the strategy is **two layers**: public records give us the *universe* (who exists, who's licensed and active,
what company) and a stable dedupe key (license number); contact details are *earned* from first-party
interactions, or filled in from sources that permit it.

## Sourcing channels, best first

### 1. Earned, first-party (highest quality — consent is built in)
1. **Listing-agent capture (live).** Every listing agent a producer enters on a property is auto-added as a
   realtor (source "Listing agent", phone stored as an office line). Every property we quote adds a partner
   candidate at no extra effort.
2. **Snapshot as the hook.** The New Listing Insurance Snapshot is genuinely useful to a listing agent. Send it
   to the listing agent for their own listing ("we prepared this for your listing at 123 Main St — feel free to
   share with buyers"). A reply gives us a verified email; a call or text-back gives a cell number and consent.
3. **Opt-in page.** A simple "Get insurance snapshots for your listings" sign-up (name, brokerage, email, cell,
   checkbox for email and separate checkbox for text consent). Records as source "Web form" with consent
   captured. Needs a public route (the app is currently login-gated end to end).
4. **Events and office visits.** Broker opens, office lunch-and-learns, lender/agent mixers, business cards.
   Type the sign-in sheet into a CSV (source "Event") and import it.
5. **Referrals.** Ask every engaged partner for two introductions.

### 2. Internal data the agency already owns (fastest first win)
- Export contacts from the agency's CRM / email / management system: realtors and lenders on past and current
  clients' transactions, and loan officers who have emailed the agency. Import as "CSV / roster".
- Mortgagee names on existing policies identify lenders worth targeting (company level — find the individual
  loan officers through the relationship).

### 3. Public licence files to build the target list
- Download the DBPR Real Estate Sales Associates & Brokers file (or the county-group files for Pinellas,
  Hillsborough, Pasco) and filter to active licences. Use it to (a) rank a target list, (b) confirm someone is
  licensed and where they work, (c) key records by licence number so no one is entered twice.
- Do the same for mortgage loan originators via NMLS lookups; consider the NMLS B2B subscription if volume
  justifies it.
- **Not built yet:** a DBPR importer. The file's exact column layout should be confirmed against a real
  download first; the generic CSV importer covers it once headers are mapped.

### 4. Enrichment for phones and emails
- Brokerage websites and association directories: check each site's terms and robots.txt, and prefer entering
  what's published for the agent you're actually contacting over bulk collection.
- A licensed data vendor is acceptable **only** if it documents where the data comes from and permits use for
  business outreach — and never for a purchased list of cell numbers to text.
- Avoid MLS portals and consumer listing sites (Zillow, homes.com, Realtor.com agent profiles): their terms
  prohibit automated collection and they actively block it. This matches how the listing-photo work was handled.

## Compliance guardrails (built into the data model)

These are practical rules, not legal advice — have counsel or the agency's compliance contact confirm before
launching outreach.

- **Cell phones.** Don't send marketing texts or use autodialed/prerecorded calls to a cell number without prior
  express written consent (TCPA); Florida's Telephone Solicitation Act adds state rules on top. The directory
  stores `sms_consent` per contact and it defaults to *none*.
- **Email.** Include the agency's physical address and a working unsubscribe in every marketing email, and
  honour opt-outs promptly (CAN-SPAM). `email_consent` and `do_not_contact` exist for this; `do_not_contact`
  is a hard stop for all outreach.
- **Referral relationships.** Realtors and mortgage lenders are settlement-service providers, and federal RESPA
  Section 8 and Florida insurance-inducement rules restrict giving or receiving anything of value for
  referrals. Keep the offering educational and service-based (market updates, snapshots), don't pay for or
  reward referrals, and get compliance sign-off on any co-marketing arrangement.
- **Provenance.** Every row keeps `source`, `source_detail` and `last_verified_at` so anyone can answer "where
  did we get this and are we allowed to use it?"
- **Retention.** Re-verify contacts at least yearly; remove or archive anyone unverified after ~24 months, and
  keep opted-out and do-not-contact records (that's the suppression list — don't delete them).

## 90-day rollout

| When | Work | Outcome |
|---|---|---|
| Week 0 | Apply migration `0009`; decide territory (Pinellas first, then Hillsborough/Pasco); load the agency's own CRM/email contacts | Directory seeded with people you already know |
| Weeks 1–3 | Pull DBPR + NMLS lists for the territory; rank targets (brokerage size, active listings we've seen) | Target universe with licence numbers |
| Weeks 2–8 | Send snapshots to listing agents on live listings; personal outreach to the top 50 realtors and top 25 loan officers; log replies (email verified, cell + consent captured) | First verified contacts with consent |
| Weeks 4–10 | Two events or office visits; launch opt-in page; referral asks | Web-form and event sign-ups |
| Weeks 8–13 | Monthly market-and-insurance update to opted-in contacts; move contacts through prospect → contacted → engaged → active partner | A working nurture rhythm |

**Measures:** contacts in territory; % with verified email; % with written SMS consent; snapshot → reply rate;
partners who have sent at least one referral.

## What's next to build (in priority order)
1. Public opt-in page for realtors/loan officers (needs a `proxy.ts` allowlist for the public route).
2. DBPR importer once we've looked at a real file (weekly refresh, license-number keyed).
3. Rank realtors by how often they appear in our listing flow, and a "needs email/cell" work queue.
4. Consent capture UI (mark email opted-in / SMS written consent with a date and note).
5. Feed the directory into the existing outreach review flow, gated on consent and do-not-contact.

## Decisions needed from you
- Territory: Pinellas only, or Tampa Bay counties from day one?
- Who sends outreach and from which address/provider (no sending provider is wired up yet).
- Whether to do the public opt-in page (needs the login gate opened for one route).
- Compliance review of the RESPA/Florida inducement wording before any partner-facing material goes out.
