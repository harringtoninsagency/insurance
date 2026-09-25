/** Formats a US phone as 727-789-2200 (extensions are dropped); anything that isn't 10 digits after an optional leading 1 is rejected. */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = raw.replace(/\s*(?:x|ext\.?|extension)\s*\d+\s*$/i, "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  if (digits.length !== 10) return null;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(raw: string | null | undefined): string | null {
  const email = raw?.trim().toLowerCase();
  return email && EMAIL_RE.test(email) ? email : null;
}

/** Trims and collapses whitespace; empty becomes null. */
export function cleanText(raw: string | null | undefined): string | null {
  const text = raw?.replace(/\s+/g, " ").trim();
  return text ? text : null;
}

/** "SMITH, JANE A" (the license-file convention) becomes "Jane A Smith"; other names are just tidied. */
export function normalizePersonName(raw: string | null | undefined): string | null {
  const text = cleanText(raw);
  if (!text) return null;
  const titleCase = (s: string) =>
    s.replace(/\w[\w'’.-]*/g, (w) => (w === w.toUpperCase() || w === w.toLowerCase() ? w[0]!.toUpperCase() + w.slice(1).toLowerCase() : w));
  const comma = text.match(/^([^,]+),\s*(.+)$/);
  return titleCase(comma ? `${comma[2]} ${comma[1]}` : text);
}
