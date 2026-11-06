# Email sending setup (Resend)

FetchRival sends approved outreach through [Resend](https://resend.com). Nothing sends until every step below is
done — until then the Outreach review screen shows what's missing and the Send buttons stay disabled.

The code is provider-agnostic (`lib/email/provider.ts`); Resend is the first implementation because it's a plain
HTTPS API with domain verification, attachments, and signed bounce/complaint webhooks.

## What you need to do (accounts, DNS and keys are yours to create)

1. **Create a Resend account** at resend.com and choose a plan (the free tier is fine to start).
2. **Verify a sending domain.** Resend gives you DNS records (SPF, DKIM, and a return-path record) to add.
   - **Decide which domain you actually control.** `harringtonagency@brightway.com` is on Brightway's domain; adding
     these records needs whoever manages `brightway.com` DNS (probably the franchise/IT team). If that's not
     practical, send from a domain the agency owns instead (for example a subdomain of an agency domain) and set
     `OUTREACH_REPLY_TO` to the Brightway address so replies still reach you.
   - Also publish a **DMARC** record for the domain (`v=DMARC1; p=none; rua=mailto:...` is a safe start). Gmail
     and Yahoo require SPF, DKIM and DMARC for bulk senders, and it materially improves inbox placement.
3. **Create an API key** in Resend (sending access is enough).
4. **Add a webhook** in Resend pointing at
   `https://insurance-rust-five.vercel.app/api/webhooks/resend`, subscribed to **email.bounced** and
   **email.complained**. Copy its signing secret (starts with `whsec_`).
5. **Generate an unsubscribe secret** — any long random string, for example:
   ```bash
   openssl rand -hex 32
   ```
6. **Add these environment variables** in both Vercel (Project → Settings → Environment Variables) and your local
   `.env.local`:

   | Variable | Value |
   |---|---|
   | `RESEND_API_KEY` | the key from step 3 |
   | `OUTREACH_FROM` | e.g. `Brightway Insurance \| The Harrington Agency <address@your-verified-domain>` |
   | `OUTREACH_POSTAL_ADDRESS` | the agency's physical mailing address (printed in every footer — CAN-SPAM requires it) |
   | `UNSUBSCRIBE_SECRET` | the random string from step 5 |
   | `RESEND_WEBHOOK_SECRET` | the `whsec_...` secret from step 4 |
   | `OUTREACH_REPLY_TO` | optional — where replies go, if different from the From address |
   | `APP_BASE_URL` | optional — defaults to `https://insurance-rust-five.vercel.app`; set it if the app moves |

   Redeploy after adding them on Vercel.
7. **Apply migration `0013_outreach_sending.sql`** in Supabase Studio.

## Try it safely first

Before sending to anyone real, queue a proposal to **your own email address**, approve it, and click Send. Check
that the attachment opens, the footer shows your postal address, and the Unsubscribe link works (it asks you to
confirm, then adds you to the suppression list — remove yourself from **Suppressions** afterward if you want more tests).

## How sending is protected

- **A producer sends, not the system.** Items go pending → approved (by a producer) → sent (by a producer's Send
  click). "Send all approved" is capped at 25 per click and asks for confirmation.
- **Checked again at send time.** Suppression list and directory (do-not-contact / opted-out) are re-checked the
  moment before sending; a blocked item is moved to rejected with the reason.
- **No double sends.** Each item is claimed before the provider is called, and the provider is given an
  idempotency key. If something dies mid-send the item is left alone rather than re-sent.
- **Every email** has the postal address, an unsubscribe link, and one-click `List-Unsubscribe` headers.
- **Unsubscribes** add the address to the suppression list and log an opt-out in the contact's history.
- **Bounces** mark the item bounced and suppress the address. **Spam complaints** suppress the address and mark the
  directory contact do-not-contact.
- **Tracking:** opens and clicks are deliberately not tracked.

## Partner quote follow-up sequence (automated)

After a **partner-submitted** quote request completes and the results email goes out, the app queues two
friendly follow-up emails to that partner (`lib/quote-requests/follow-ups.ts`):

| Touch | Sends | Subject |
|---|---|---|
| 1 | 2 business days after completion | Quick check-in on *{address}* |
| 2 | 7 business days after completion | Closing the loop on *{address}* |

- **Who signs:** the agent assigned to the request in Clear to Close (property assignment first, then the
  request's own "Assigned to", then the partner's linked agent — the same precedence the proposal PDFs use).
  With no agent assigned, the email signs as the agency: Brightway Insurance, The Harrington Agency,
  727-789-2200, HarringtonAgency@Brightway.com. Resolved at send time, so assigning an agent after touch 1
  changes who signs touch 2.
- **CC:** `harringtonagency@brightway.com` on every touch, plus the assigned agent. Reply-to is the signer.
- **Sent by a Vercel cron** (`vercel.json` → `/api/cron/quote-follow-ups`, weekday mornings ET). Vercel
  authenticates the call with the project's `CRON_SECRET` env var — **add `CRON_SECRET`** (any long random
  string, e.g. `openssl rand -hex 32`) in Vercel, then redeploy. Without it the route refuses to run.
- **Stops automatically** when the partner submits a newer request for the same property, the address lands on
  the suppression list / do-not-contact / opted out, or a touch bounces or is marked spam. A producer can also
  click **Stop follow-ups** on the row in `/quote-requests` (the partner replied, the buyer bound, etc.).
- **Apply migration `0041_quote_request_follow_ups.sql`** in Supabase Studio.
- Public, internal, and consumer requests never get this sequence.

## Not covered yet

- Confirmation ("double opt-in") emails for people who sign up on `/partners`.
- Follow-up sequences for anything other than partner quote requests — outreach sends are still one-offs.
- A stuck item (process died after the provider accepted the message but before the result was saved) isn't
  shown in any list; it's deliberately not re-sent. Check the Resend dashboard if you suspect one.
