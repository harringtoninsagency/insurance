// Gmail REST API client for the automated OneHome ingest. Replaces the earlier
// IMAP client: IMAP (port 993) is a raw TCP/TLS protocol that the cloud
// sandbox's HTTPS egress proxy resets mid-handshake, whereas the REST API is
// plain HTTPS and works through it. Auth is a Bearer token from
// GMAIL_ACCESS_TOKEN when set; otherwise the request is sent unauthenticated
// and the environment's proxy is expected to inject credentials for the
// Gmail host (the "inject Gmail" connector). No app password is needed.

export interface GmailMessage {
  subject: string;
  receivedDateTime: string;
  bodyText: string;
  bodyHtml: string;
}

interface GmailPart {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPart[];
}

const GMAIL_API = process.env.GMAIL_API_BASE ?? "https://gmail.googleapis.com/gmail/v1/users/me";

async function gmailGet<T>(path: string): Promise<T> {
  const token = process.env.GMAIL_ACCESS_TOKEN;
  const res = await fetch(`${GMAIL_API}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`Gmail API ${path.split("?")[0]} failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

/** Depth-first search of a MIME tree for the first part of the given type. */
function findBody(part: GmailPart | undefined, mimeType: string): string {
  if (!part) return "";
  if (part.mimeType === mimeType && part.body?.data) {
    return Buffer.from(part.body.data, "base64url").toString("utf8");
  }
  for (const child of part.parts ?? []) {
    const found = findBody(child, mimeType);
    if (found) return found;
  }
  return "";
}

/**
 * Fetches inbox messages received in the last `sinceHours` hours, with both
 * the plain-text body and the HTML body (`parseOneHomeListingsFromHtml` and
 * `extractListingPhotos` need the HTML). Deliberately not filtered by
 * sender/subject: the OneHome template is matched by content, not envelope,
 * so this keeps working even if OneHome changes their sending address.
 */
export async function fetchRecentGmailBodies(sinceHours: number): Promise<GmailMessage[]> {
  const afterSeconds = Math.floor((Date.now() - sinceHours * 60 * 60 * 1000) / 1000);
  const q = encodeURIComponent(`in:inbox after:${afterSeconds}`);

  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const list = await gmailGet<{ messages?: { id: string }[]; nextPageToken?: string }>(
      `/messages?q=${q}&maxResults=100${pageToken ? `&pageToken=${pageToken}` : ""}`,
    );
    ids.push(...(list.messages ?? []).map((m) => m.id));
    pageToken = list.nextPageToken;
  } while (pageToken);

  const messages: GmailMessage[] = [];
  for (const id of ids) {
    const msg = await gmailGet<{ internalDate?: string; payload?: GmailPart & { headers?: { name: string; value: string }[] } }>(
      `/messages/${id}?format=full`,
    );
    const subject = msg.payload?.headers?.find((h) => h.name.toLowerCase() === "subject")?.value;
    messages.push({
      subject: subject ?? "(no subject)",
      receivedDateTime: new Date(Number(msg.internalDate ?? Date.now())).toISOString(),
      bodyText: findBody(msg.payload, "text/plain"),
      bodyHtml: findBody(msg.payload, "text/html"),
    });
  }
  return messages;
}
