// Minimal Microsoft Graph client for the automated OneHome ingest. Uses the
// OAuth2 client-credentials (app-only) flow, since this runs unattended on a
// schedule with no signed-in user to complete an interactive consent —
// requires an Entra ID app registration with application-level Mail.Read
// permission (admin-consented) on the target mailbox. See README for setup.

export interface GraphMailMessage {
  subject: string;
  receivedDateTime: string;
  bodyText: string;
}

interface GraphTokenResponse {
  access_token: string;
  error?: string;
  error_description?: string;
}

interface GraphMessageResource {
  subject?: string;
  receivedDateTime?: string;
  body?: { content?: string };
}

interface GraphMessagesResponse {
  value?: GraphMessageResource[];
  error?: { message?: string };
}

async function getAppOnlyToken(): Promise<string> {
  const tenantId = process.env.MS_GRAPH_TENANT_ID;
  const clientId = process.env.MS_GRAPH_CLIENT_ID;
  const clientSecret = process.env.MS_GRAPH_CLIENT_SECRET;
  if (!tenantId || !clientId || !clientSecret) {
    throw new Error(
      "Missing MS_GRAPH_TENANT_ID / MS_GRAPH_CLIENT_ID / MS_GRAPH_CLIENT_SECRET in the environment"
    );
  }

  const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
  });
  const json = (await res.json()) as GraphTokenResponse;
  if (!res.ok || !json.access_token) {
    throw new Error(`Failed to get Graph token: ${json.error_description ?? json.error ?? res.statusText}`);
  }
  return json.access_token;
}

/**
 * Fetches inbox messages received in the last `sinceHours` hours from the
 * configured mailbox, with the plain-text body (not HTML) already resolved
 * by Graph. Deliberately not filtered by sender/subject — the OneHome
 * template is matched by `parseOneHomeListingsFromText` instead, so this
 * keeps working even if OneHome changes their sending address.
 */
export async function fetchRecentMailBodies(sinceHours: number): Promise<GraphMailMessage[]> {
  const mailbox = process.env.ONEHOME_MAILBOX;
  if (!mailbox) throw new Error("Missing ONEHOME_MAILBOX in the environment");

  const token = await getAppOnlyToken();
  const since = new Date(Date.now() - sinceHours * 60 * 60 * 1000).toISOString();
  const url = new URL(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/mailFolders/inbox/messages`);
  url.searchParams.set("$filter", `receivedDateTime ge ${since}`);
  url.searchParams.set("$select", "subject,receivedDateTime,body");
  url.searchParams.set("$top", "50");

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      // Without this, Graph returns HTML; the listing regex expects the
      // same plain-text layout msgreader gives us from a saved .msg file.
      Prefer: 'outlook.body-content-type="text"',
    },
  });
  const json = (await res.json()) as GraphMessagesResponse;
  if (!res.ok) {
    throw new Error(`Graph messages request failed: ${json.error?.message ?? res.statusText}`);
  }

  return (json.value ?? []).map((m) => ({
    subject: m.subject ?? "(no subject)",
    receivedDateTime: m.receivedDateTime ?? "",
    bodyText: m.body?.content ?? "",
  }));
}
