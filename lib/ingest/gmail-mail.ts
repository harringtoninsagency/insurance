import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

// Minimal Gmail IMAP client for the automated OneHome ingest. Uses a Gmail
// "app password" (requires 2-Step Verification on the account) rather than
// full OAuth — much less setup for a single mailbox, and this only ever
// needs read access to recent mail. See docs/process-onehome-listings.md for
// setup. Sibling to lib/ingest/graph-mail.ts (Microsoft Graph, used before
// the daily OneHome email moved to a Gmail inbox) — kept separate rather
// than merged since the two mailboxes may both be in use.

export interface GmailMessage {
  subject: string;
  receivedDateTime: string;
  bodyText: string;
  bodyHtml: string;
}

/**
 * Fetches inbox messages received in the last `sinceHours` hours, with both
 * the plain-text body (for `parseOneHomeListingsFromText`) and the HTML body
 * (for `extractListingPhotos`, which needs the <img> tags plain text lacks).
 * Deliberately not filtered by sender/subject, same reasoning as the Graph
 * client: the OneHome template is matched by content, not envelope, so this
 * keeps working even if OneHome changes their sending address.
 */
export async function fetchRecentGmailBodies(sinceHours: number): Promise<GmailMessage[]> {
  const user = process.env.GMAIL_IMAP_USER;
  const appPassword = process.env.GMAIL_IMAP_APP_PASSWORD;
  if (!user || !appPassword) {
    throw new Error("Missing GMAIL_IMAP_USER / GMAIL_IMAP_APP_PASSWORD in the environment");
  }

  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user, pass: appPassword },
    logger: false,
  });

  const messages: GmailMessage[] = [];
  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const since = new Date(Date.now() - sinceHours * 60 * 60 * 1000);
      for await (const message of client.fetch({ since }, { source: true })) {
        if (!message.source) continue;
        const parsed = await simpleParser(message.source);
        messages.push({
          subject: parsed.subject ?? "(no subject)",
          receivedDateTime: (parsed.date ?? new Date()).toISOString(),
          bodyText: parsed.text ?? "",
          bodyHtml: typeof parsed.html === "string" ? parsed.html : "",
        });
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }

  return messages;
}
