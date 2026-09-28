import { createHmac, timingSafeEqual } from "node:crypto";

// An unsubscribe link identifies one outreach item. The id alone isn't secret
// (it's a UUID that may leak), so the link carries an HMAC only this server
// can produce — nobody can unsubscribe a stranger by guessing ids.

const sign = (outreachId: string, secret: string) => createHmac("sha256", secret).update(outreachId).digest("base64url");

export function createUnsubscribeToken(outreachId: string, secret: string): string {
  return `${outreachId}.${sign(outreachId, secret)}`;
}

/** Returns the outreach id if the token is genuine, otherwise null. */
export function verifyUnsubscribeToken(token: string, secret: string): string | null {
  const dot = token.lastIndexOf(".");
  if (dot < 1) return null;
  const id = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(sign(id, secret));
  return given.length === expected.length && timingSafeEqual(given, expected) ? id : null;
}
