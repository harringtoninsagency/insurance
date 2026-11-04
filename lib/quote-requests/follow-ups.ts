import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceSupabase } from "@/lib/supabase/server";
import { loadEmailConfig, type EmailConfig } from "@/lib/email/config";
import { resendProvider, type EmailProvider } from "@/lib/email/provider";
import { escapeHtml } from "@/lib/email/escape-html";
import { brandedEmailShell, DEEP_BLUE, SLATE_MUTED } from "@/lib/email/brand-template";
import { checkRecipient } from "@/lib/outreach/check-recipient";
import { CONTACT_PHONE } from "@/lib/contacts/consent-text";
import { resolveProposalAgent } from "@/lib/quote-requests/proposal-agent";
import { addBusinessDays, todayEt } from "@/lib/dates";
import { appBaseUrl } from "@/lib/base-url";
import type { Database } from "@/lib/types/database";

// ---------------------------------------------------------------------------
// Two-touch follow-up sequence to a referral partner after their quote
// request completes and the results email (lib/quote-requests/
// completion-email.ts) has gone out.
//
//   touch 1 — 2 business days after completion: a friendly check-in that
//             nudges the partner to forward the results to their buyer.
//   touch 2 — 7 business days after completion: a soft close that keeps the
//             door open and points back at the portal for the next deal.
//
// Partner-submitted requests only. Rows are scheduled by
// scheduleQuoteRequestFollowUps (called from finalizeQuoteRequest) and sent
// by sendDueQuoteRequestFollowUps (the daily Vercel cron at
// app/api/cron/quote-follow-ups). Unlike the completion email — which has
// to be handed to the Resend MCP tool because the quoting routine's own
// egress proxy blocks api.resend.com — this runs on Vercel, where a plain
// Resend HTTP call works, so it sends directly (same as sendApprovedOutreach).
//
// Who signs: the agent assigned to the request in Clear to Close (same
// precedence resolveProposalAgent uses for the PDFs — property assignment,
// then the request's own assignment, then the partner's linked agent).
// When nobody is assigned, the email signs as the agency itself —
// Brightway Insurance, The Harrington Agency, 727-789-2200,
// HarringtonAgency@Brightway.com — by explicit instruction, not as a
// default admin. Resolved at send time, so assigning an agent between
// touch 1 and touch 2 means touch 2 goes out under that agent.
//
// Every touch CC's the agency inbox, by explicit instruction.
// ---------------------------------------------------------------------------

export const FOLLOW_UP_TOUCHES = [
  { touch: 1 as const, businessDaysAfterCompletion: 2 },
  { touch: 2 as const, businessDaysAfterCompletion: 7 },
];

/** Same agency copy address as the completion email — every touch CC's it. */
export const AGENCY_CC = "harringtonagency@brightway.com";
/** As the agency wants it displayed in a signature (addresses are case-insensitive, so the CC above still matches). */
const AGENCY_DISPLAY_EMAIL = "HarringtonAgency@Brightway.com";
const AGENCY_NAME = "Brightway Insurance, The Harrington Agency";
const AGENCY_SIGN_OFF = "The Harrington Agency team";
const ESTIMATE_DISCLAIMER = "All rates shown are estimates until customer data and inspections validate them.";

type FollowUpRow = Database["public"]["Tables"]["quote_request_follow_ups"]["Row"];
type Touch = FollowUpRow["touch"];

/**
 * Schedules both touches for a just-completed partner request. Idempotent
 * (unique on quote_request_id + touch, duplicates ignored) and never throws:
 * a scheduling problem must not turn a completed quote request into a
 * failure. Any other requester_type is a no-op.
 */
export async function scheduleQuoteRequestFollowUps(quoteRequestId: string, now: Date = new Date()): Promise<void> {
  try {
    const supabase = createServiceSupabase();
    const { data: request } = await supabase
      .from("quote_requests")
      .select("agency_id, requester_type, contact_id, status")
      .eq("id", quoteRequestId)
      .maybeSingle();
    if (!request || request.requester_type !== "partner" || !request.contact_id || request.status !== "completed") return;

    const completedOn = todayEt(now);
    const rows = FOLLOW_UP_TOUCHES.map(({ touch, businessDaysAfterCompletion }) => ({
      agency_id: request.agency_id,
      quote_request_id: quoteRequestId,
      touch,
      scheduled_for: addBusinessDays(completedOn, businessDaysAfterCompletion),
    }));
    const { error } = await supabase
      .from("quote_request_follow_ups")
      .upsert(rows, { onConflict: "quote_request_id,touch", ignoreDuplicates: true });
    if (error) console.error(`Couldn't schedule follow-ups for quote request ${quoteRequestId}: ${error.message}`);
  } catch (err) {
    console.error(`Couldn't schedule follow-ups for quote request ${quoteRequestId}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Ends the sequence for a request: every touch not yet sent is marked
 * stopped with the reason. Used by the dashboard's "Stop follow-ups" button
 * (the partner replied, the buyer bound, they went elsewhere) and by the
 * sender's own exit rules below. Already-sent rows are left as history.
 */
export async function stopQuoteRequestFollowUps(
  supabase: SupabaseClient<Database>,
  quoteRequestId: string,
  reason: string
): Promise<{ stopped: number }> {
  const { data, error } = await supabase
    .from("quote_request_follow_ups")
    .update({ stopped_at: new Date().toISOString(), stopped_reason: reason })
    .eq("quote_request_id", quoteRequestId)
    .is("sent_at", null)
    .is("stopped_at", null)
    .select("id");
  if (error) throw new Error(`Couldn't stop follow-ups: ${error.message}`);
  return { stopped: data?.length ?? 0 };
}

// ---------------------------------------------------------------------------
// Email content
// ---------------------------------------------------------------------------

export interface FollowUpSender {
  /** How the email signs off ("Tim" / "The Harrington Agency team"). */
  signOff: string;
  /** The person's full name on the signature line, or null when signing as the agency (the agency line then shows once). */
  name: string | null;
  email: string;
  phone: string;
}

export interface FollowUpEmailInput {
  touch: Touch;
  partnerFirstName: string;
  propertyAddress: string;
  sender: FollowUpSender;
  portalUrl: string;
}

export interface FollowUpEmailContent {
  subject: string;
  text: string;
  html: string;
}

function firstNameOf(fullName: string | null | undefined, fallback: string): string {
  const first = fullName?.trim().split(/\s+/)[0];
  return first || fallback;
}

/** Pure — builds the subject/text/html for one touch. Exported so the copy can be previewed or tested without a database. */
export function buildFollowUpEmail(input: FollowUpEmailInput): FollowUpEmailContent {
  const { touch, partnerFirstName, propertyAddress, sender, portalUrl } = input;

  const signatureText = [sender.signOff, sender.name, AGENCY_NAME, `${sender.phone} · ${sender.email}`].filter((l): l is string => !!l).join("\n");
  const signatureHtml = [
    `<p style="margin:24px 0 0;">${escapeHtml(sender.signOff)}</p>`,
    sender.name ? `<p style="margin:16px 0 0;font-weight:bold;color:${DEEP_BLUE};">${escapeHtml(sender.name)}</p>` : "",
    `<p style="margin:${sender.name ? "0" : "16px 0 0"};${sender.name ? "" : `font-weight:bold;color:${DEEP_BLUE};`}">${escapeHtml(AGENCY_NAME)}</p>`,
    `<p style="margin:0;color:${SLATE_MUTED};">${escapeHtml(sender.phone)} · <a href="mailto:${escapeHtml(sender.email)}" style="color:${SLATE_MUTED};">${escapeHtml(sender.email)}</a></p>`,
    `<p style="margin:24px 0 0;font-size:12px;color:${SLATE_MUTED};"><em>${escapeHtml(ESTIMATE_DISCLAIMER)}</em></p>`,
  ].join("");

  const p = (s: string) => `<p style="margin:0 0 16px;">${s}</p>`;
  const li = (s: string) => `<li style="margin:0 0 10px;">${s}</li>`;
  const ul = (items: string[]) => `<ul style="margin:0 0 16px;padding-left:20px;">${items.join("")}</ul>`;
  const hi = `Hi ${partnerFirstName},`;
  const address = escapeHtml(propertyAddress);

  if (touch === 1) {
    const text = [
      hi,
      "",
      `Just circling back on the home insurance options we sent over for ${propertyAddress}. Hopefully they landed in a good spot and gave you a clear number to work with on the deal.`,
      "",
      "A couple of quick things that tend to help at this stage:",
      "",
      "- Feel free to forward the results straight to your buyer. They're written for the buyer, and we're happy to walk them through the options on a quick call so you don't have to field the insurance questions yourself.",
      "- If anything about the property changed (roof date, a 4-point or wind mit came back, closing date moved), just reply here and we'll refresh the numbers the same day.",
      "",
      "And if it's all set and we're just waiting on closing, no action needed. We'll be ready to bind as soon as your buyer gives the word.",
      "",
      "Thanks for trusting us with this one.",
      "",
      signatureText,
      "",
      ESTIMATE_DISCLAIMER,
    ].join("\n");

    const html = brandedEmailShell(
      [
        p(escapeHtml(hi)),
        p(`Just circling back on the home insurance options we sent over for <strong>${address}</strong>. Hopefully they landed in a good spot and gave you a clear number to work with on the deal.`),
        p("A couple of quick things that tend to help at this stage:"),
        ul([
          li("<strong>Feel free to forward the results straight to your buyer.</strong> They're written for the buyer, and we're happy to walk them through the options on a quick call so you don't have to field the insurance questions yourself."),
          li("<strong>If anything about the property changed</strong> (roof date, a 4-point or wind mit came back, closing date moved), just reply here and we'll refresh the numbers the same day."),
        ]),
        p("And if it's all set and we're just waiting on closing, no action needed. We'll be ready to bind as soon as your buyer gives the word."),
        p("Thanks for trusting us with this one."),
        signatureHtml,
      ].join("")
    );

    return { subject: `Quick check-in on ${propertyAddress}`, text, html };
  }

  const text = [
    hi,
    "",
    `One more note on ${propertyAddress} and then we'll get out of your inbox.`,
    "",
    "If your buyer went another direction on the insurance, no hard feelings at all. That happens, and we'd still rather you have a real set of options in hand than guess at the number. If they're still deciding, we're glad to jump on a 10-minute call with them (or with you) to compare the carriers side by side and make the choice simple.",
    "",
    "Either way, the Clear to Close portal is yours to use on every deal, not just this one. Drop in the next address and you'll have numbers back before your buyer finishes the showing.",
    "",
    "Two easy next steps if you want them:",
    "",
    `- Call or email us: ${sender.phone} · ${sender.email}`,
    `- Send your next closing: ${portalUrl}`,
    "",
    `Thanks again for the referral, ${partnerFirstName}. Hope the rest of the week is a good one.`,
    "",
    signatureText,
    "",
    ESTIMATE_DISCLAIMER,
  ].join("\n");

  const html = brandedEmailShell(
    [
      p(escapeHtml(hi)),
      p(`One more note on <strong>${address}</strong> and then we'll get out of your inbox.`),
      p("If your buyer went another direction on the insurance, no hard feelings at all. That happens, and we'd still rather you have a real set of options in hand than guess at the number. If they're still deciding, we're glad to jump on a 10-minute call with them (or with you) to compare the carriers side by side and make the choice simple."),
      p("Either way, the Clear to Close portal is yours to use on every deal, not just this one. Drop in the next address and you'll have numbers back before your buyer finishes the showing."),
      p("Two easy next steps if you want them:"),
      ul([
        li(`<strong>Call or email us:</strong> ${escapeHtml(sender.phone)} · <a href="mailto:${escapeHtml(sender.email)}" style="color:${DEEP_BLUE};">${escapeHtml(sender.email)}</a>`),
        li(`<strong>Send your next closing:</strong> <a href="${escapeHtml(portalUrl)}" style="color:${DEEP_BLUE};">${escapeHtml(portalUrl)}</a>`),
      ]),
      p(`Thanks again for the referral, ${escapeHtml(partnerFirstName)}. Hope the rest of the week is a good one.`),
      signatureHtml,
    ].join("")
  );

  return { subject: `Closing the loop on ${propertyAddress}`, text, html };
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

export type FollowUpSendResult =
  | { id: string; status: "sent"; messageId: string }
  | { id: string; status: "skipped"; reason: string }
  | { id: string; status: "stopped"; reason: string }
  | { id: string; status: "failed"; error: string };

export interface FollowUpRunSummary {
  due: number;
  sent: number;
  stopped: number;
  failed: number;
  skipped: number;
  results: FollowUpSendResult[];
}

/**
 * Resolves who signs this request's follow-ups right now. Agent assignment
 * wins (resolveProposalAgent's precedence, minus its default-admin
 * fallback); otherwise the agency itself.
 */
async function resolveFollowUpSender(propertyId: string, quoteRequestId: string): Promise<{ sender: FollowUpSender; agentEmail: string | null }> {
  const agent = await resolveProposalAgent(propertyId, quoteRequestId, { fallbackToDefaultAdmin: false });
  if (agent) {
    return {
      sender: { signOff: firstNameOf(agent.name, agent.name), name: agent.name, email: agent.email, phone: CONTACT_PHONE },
      agentEmail: agent.email,
    };
  }
  return {
    sender: { signOff: AGENCY_SIGN_OFF, name: null, email: AGENCY_DISPLAY_EMAIL, phone: CONTACT_PHONE },
    agentEmail: null,
  };
}

/**
 * Sends one due touch. Same protection as sendApprovedOutreach: the row is
 * claimed (sent_at set) before the provider is called, so an overlapping run
 * can't send it twice, and a failed send releases the claim for the next
 * run. Exit rules checked at send time (a stop here ends the whole sequence):
 *   - the request is no longer a completed partner request, or its contact
 *     is gone
 *   - the partner put in a newer request for the same property (they're
 *     clearly still engaged — a stale check-in would just be noise)
 *   - the address is suppressed / do-not-contact / opted out
 */
export async function sendQuoteRequestFollowUp(
  followUpId: string,
  provider: EmailProvider,
  config: EmailConfig,
  supabase: SupabaseClient<Database> = createServiceSupabase()
): Promise<FollowUpSendResult> {
  const { data: claimed, error: claimError } = await supabase
    .from("quote_request_follow_ups")
    .update({ sent_at: new Date().toISOString(), send_error: null })
    .eq("id", followUpId)
    .is("sent_at", null)
    .is("stopped_at", null)
    .select("id, agency_id, quote_request_id, touch")
    .maybeSingle();
  if (claimError) return { id: followUpId, status: "failed", error: claimError.message };
  if (!claimed) return { id: followUpId, status: "skipped", reason: "Already sent or stopped." };

  const release = (error: string) => supabase.from("quote_request_follow_ups").update({ sent_at: null, send_error: error }).eq("id", followUpId);
  const stop = async (reason: string): Promise<FollowUpSendResult> => {
    await supabase.from("quote_request_follow_ups").update({ sent_at: null }).eq("id", followUpId);
    await stopQuoteRequestFollowUps(supabase, claimed.quote_request_id, reason);
    return { id: followUpId, status: "stopped", reason };
  };

  try {
    const { data: request } = await supabase
      .from("quote_requests")
      .select("id, agency_id, requester_type, status, contact_id, property_id, created_at")
      .eq("id", claimed.quote_request_id)
      .maybeSingle();
    if (!request || request.requester_type !== "partner" || request.status !== "completed" || !request.contact_id || !request.property_id) {
      return stop("Request is no longer a completed partner request.");
    }

    const [{ data: contact }, { data: property }, { data: newer }] = await Promise.all([
      supabase.from("industry_contacts").select("id, full_name, email").eq("id", request.contact_id).maybeSingle(),
      supabase.from("properties").select("address").eq("id", request.property_id).maybeSingle(),
      supabase
        .from("quote_requests")
        .select("id")
        .eq("contact_id", request.contact_id)
        .eq("property_id", request.property_id)
        .gt("created_at", request.created_at)
        .limit(1),
    ]);
    if (!contact?.email || !property) return stop("Partner contact or property no longer on file.");
    if (newer?.length) return stop("Partner submitted a newer request for this property.");

    const check = await checkRecipient(supabase, request.agency_id, contact.email);
    if (!check.allowed) return stop(check.reason);

    const { sender, agentEmail } = await resolveFollowUpSender(request.property_id, request.id);
    const content = buildFollowUpEmail({
      touch: claimed.touch,
      partnerFirstName: firstNameOf(contact.full_name, "there"),
      propertyAddress: property.address,
      sender,
      portalUrl: `${appBaseUrl()}/partner`,
    });

    // Agency copy always; the assigned agent too when there is one and it
    // isn't already the recipient or the agency inbox.
    const seen = new Set([contact.email.toLowerCase(), AGENCY_CC]);
    const cc = [AGENCY_CC];
    if (agentEmail && !seen.has(agentEmail.toLowerCase())) cc.push(agentEmail);

    const { id: messageId } = await provider.send({
      from: config.from,
      to: contact.email,
      cc,
      // Replies land with the person who signed it: the assigned agent, or
      // the agency inbox when signing as the agency.
      replyTo: agentEmail ?? AGENCY_CC,
      subject: content.subject,
      html: content.html,
      text: content.text,
      idempotencyKey: `quote-follow-up-${followUpId}`,
    });

    await supabase.from("quote_request_follow_ups").update({ provider_message_id: messageId, send_error: null }).eq("id", followUpId);
    return { id: followUpId, status: "sent", messageId };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Send failed";
    await release(message);
    return { id: followUpId, status: "failed", error: message };
  }
}

/**
 * The daily cron's whole job: every touch whose scheduled_for is today or
 * earlier (ET) and that hasn't been sent or stopped, oldest first. Returns a
 * summary for the cron response/logs. Throws only when email isn't
 * configured at all, so the cron run shows up as a failure in Vercel.
 */
export async function sendDueQuoteRequestFollowUps(now: Date = new Date()): Promise<FollowUpRunSummary> {
  const cfg = loadEmailConfig();
  if (!cfg.ok) throw new Error(`Email isn't configured: missing ${cfg.missing.join(", ")}`);

  const supabase = createServiceSupabase();
  const { data: due, error } = await supabase
    .from("quote_request_follow_ups")
    .select("id")
    .lte("scheduled_for", todayEt(now))
    .is("sent_at", null)
    .is("stopped_at", null)
    .order("scheduled_for")
    .order("touch")
    .limit(100);
  if (error) throw new Error(`Couldn't load due follow-ups: ${error.message}`);

  const provider = resendProvider(cfg.config.apiKey);
  const results: FollowUpSendResult[] = [];
  for (const row of due ?? []) {
    results.push(await sendQuoteRequestFollowUp(row.id, provider, cfg.config, supabase));
  }
  const count = (status: FollowUpSendResult["status"]) => results.filter((r) => r.status === status).length;
  return { due: due?.length ?? 0, sent: count("sent"), stopped: count("stopped"), failed: count("failed"), skipped: count("skipped"), results };
}
