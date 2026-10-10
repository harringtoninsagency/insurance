export interface OutboundEmail {
  from: string;
  to: string;
  cc?: string | string[];
  subject: string;
  html: string;
  text: string;
  replyTo?: string | null;
  headers?: Record<string, string>;
  attachments?: Array<{ filename: string; content: Buffer }>;
  /** Same key => the provider won't send twice (Resend remembers it for 24h). */
  idempotencyKey?: string;
}

/** The only thing the rest of the app knows about the email service. */
export interface EmailProvider {
  send(email: OutboundEmail): Promise<{ id: string }>;
}

export function resendProvider(apiKey: string): EmailProvider {
  return {
    async send(email) {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          ...(email.idempotencyKey ? { "Idempotency-Key": email.idempotencyKey } : {}),
        },
        body: JSON.stringify({
          from: email.from,
          to: [email.to],
          ...(email.cc ? { cc: Array.isArray(email.cc) ? email.cc : [email.cc] } : {}),
          subject: email.subject,
          html: email.html,
          text: email.text,
          ...(email.replyTo ? { reply_to: email.replyTo } : {}),
          ...(email.headers ? { headers: email.headers } : {}),
          ...(email.attachments?.length
            ? { attachments: email.attachments.map((a) => ({ filename: a.filename, content: a.content.toString("base64") })) }
            : {}),
        }),
      });

      const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
      if (!res.ok || !body.id) {
        throw new Error(`Resend ${res.status}: ${body.message ?? body.name ?? "no message id returned"}`);
      }
      return { id: body.id };
    },
  };
}
