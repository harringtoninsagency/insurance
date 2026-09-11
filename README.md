# FetchRival

Internal FL homeowners (HO-3/HO-6/DP-3) listing-to-proposal engine. See
`FetchRivalImplementationPlan.pdf` for the full plan; this is the Phase 1
foundation: Next.js + Supabase scaffold, schema + RLS, auth, storage buckets,
agency seed, and the property detail UI.

## Status

Phase 1 only. No listing ingest (Phase 3), enrichment/rating (Phase 4), PDF
generation (Phase 5), or outreach sending (Phase 6) yet — those screens exist
as read-only stubs so the shape of the app is visible before the pipelines
that fill them are built.

## Prerequisites

- **Node.js** (installed via winget: `OpenJS.NodeJS.LTS`, currently v24). If a
  fresh terminal can't find `node`/`npm`, sign out and back in (or reboot) so
  Windows picks up the PATH change made by the installer.
- **Supabase CLI** — `npm install -g supabase` (or see
  https://supabase.com/docs/guides/cli), needed to run migrations and
  optionally a local Supabase stack via Docker.

## Setup

```bash
npm install
```

Create a Supabase project (https://supabase.com/dashboard), then:

```bash
cp .env.local.example .env.local
# fill in NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
# SUPABASE_SERVICE_ROLE_KEY from Project Settings -> API

supabase link --project-ref <your-project-ref>
supabase db push          # applies supabase/migrations/0001_init_schema.sql
psql "$SUPABASE_DB_URL" -f supabase/seed.sql   # or run seed.sql in the SQL editor
```

Create your first user (Supabase Studio -> Authentication -> Add user), then
link it to the seeded agency in the SQL editor:

```sql
insert into public.profiles (id, agency_id, email, role)
values ('<auth-user-uuid>', (select id from public.agencies limit 1), '<email>', 'admin');
```

Once linked, generate real TS types from the live schema (replaces the
hand-written `lib/types/database.ts`):

```bash
supabase gen types typescript --linked > lib/types/database.ts
```

Run the app:

```bash
npm run dev
```

## Automated OneHome ingest

`scripts/auto-ingest-onehome.ts` polls a mailbox for the daily OneHome
saved-search email, upserts any highlighted listings into `properties`, and
pulls county enrichment for anything new — the same two steps you'd otherwise
trigger by hand via `scripts/ingest-onehome-email.ts` + the "Pull county
data" button. It deliberately stops there: running Fetch quotes needs a live
Claude session (the quoting MCP tools aren't callable from a standalone
script), so that step still means asking Claude to run the bulk-quote
pipeline for whatever this script ingested.

It's meant to run as a Windows Scheduled Task on whatever machine is
normally on, not as a deployed server — there's no cloud hosting for this
app today. Reading the mailbox needs an Entra ID (Azure AD) app registration
with **application** (not delegated) `Mail.Read` permission, since this runs
unattended with no signed-in user to complete an interactive consent:

1. In the Entra admin center (https://entra.microsoft.com), **App
   registrations -> New registration**. Any name/redirect URI is fine — this
   app only ever uses the client-credentials flow.
2. **API permissions -> Add a permission -> Microsoft Graph -> Application
   permissions -> Mail.Read**, then **Grant admin consent** (needs a tenant
   admin).
3. **Certificates & secrets -> New client secret**. Copy the value
   immediately — it's not retrievable later.
4. Note the **Tenant ID** and **Application (client) ID** from the app's
   Overview page.
5. Fill in `MS_GRAPH_TENANT_ID`, `MS_GRAPH_CLIENT_ID`,
   `MS_GRAPH_CLIENT_SECRET`, and `ONEHOME_MAILBOX` (the address that
   receives the OneHome emails) in `.env.local`.

Application-level `Mail.Read` grants read access to every mailbox in the
tenant by default. To scope it down to just `ONEHOME_MAILBOX`, a tenant admin
can run an Exchange Online PowerShell `New-ApplicationAccessPolicy` for this
app's client ID — worth doing, but not required to get the script running.

Test it manually before scheduling it:

```bash
npx tsx scripts/auto-ingest-onehome.ts
```

It logs to both stdout and `logs/onehome-auto-ingest.log`, so a scheduled,
unattended run still leaves a record of what it found and did.

## Architecture notes

- Every business table carries `agency_id` even though this build is single
  tenant, so productizing to multiple agencies later is a config change, not
  a schema rewrite.
- RLS policies key off `public.current_agency_id()`, which resolves the
  calling user's agency from `public.profiles`.
- Storage objects are keyed `<agency_id>/<property_id>/<filename>` — the
  bucket policies in the migration depend on that convention.
- Carrier quoting and listing ingest are meant to sit behind pluggable
  interfaces (`CarrierQuoteAdapter`, `ListingSource`) per the plan, added in
  Phases 2–3 once there's a concrete second implementation to justify the
  interface.
- Stack versions were pinned to what's actually current as of this build
  (Next 16 / React 19 / Tailwind v4 / `@supabase/supabase-js` 2.115), not the
  versions in the original plan doc, which had drifted. Tailwind v4 has no
  `tailwind.config.ts` — it scans content automatically and is wired in via
  `@tailwindcss/postcss` in `postcss.config.js` plus `@import "tailwindcss";`
  in `app/globals.css`. Next 16 also renamed the `middleware.ts` convention to
  `proxy.ts` (same behavior, `export function proxy` instead of `middleware`).
  TypeScript's `latest` tag is now a major-version-7 native rewrite; this
  project stays on the 5.9.x line until that ecosystem matures.
