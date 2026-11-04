/** Today's date (YYYY-MM-DD) in the agency's time zone — a bare `new Date().toISOString()` flips to tomorrow every evening. */
export function todayEt(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/**
 * A todayEt()-shaped day key plus N business days (Mon–Fri), as another day
 * key. Counts only weekdays forward from `dayKey`, so "+2" from a Thursday is
 * the following Monday and "+2" from a Saturday is Tuesday. US holidays are
 * deliberately not skipped — a follow-up landing on one just sits in the
 * inbox like any other weekday email.
 */
export function addBusinessDays(dayKey: string, days: number): string {
  const [year, month, day] = dayKey.split("-").map(Number);
  // Noon UTC keeps the date arithmetic clear of any DST edge when formatting back out.
  const date = new Date(Date.UTC(year!, month! - 1, day!, 12));
  let remaining = days;
  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    const dow = date.getUTCDay();
    if (dow !== 0 && dow !== 6) remaining -= 1;
  }
  return date.toISOString().slice(0, 10);
}

/** Formats a YYYY-MM-DD date column as M/D/YYYY without a time-zone shift. */
export function formatDateOnly(value: string | null | undefined): string {
  const m = value?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${Number(m[2])}/${Number(m[3])}/${m[1]}` : "—";
}

/** A todayEt()-shaped day key ("2026-10-07") -> "Tuesday, October 7, 2026" for a collapsible day-section heading. */
export function formatDayHeading(dayKey: string): string {
  const [year, month, day] = dayKey.split("-").map(Number);
  const date = new Date(year!, month! - 1, day!);
  return new Intl.DateTimeFormat("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" }).format(date);
}

/** An ISO timestamp -> its calendar date in the agency's time zone, e.g. "10/16/2026" — a bare `new Date(iso).toLocaleDateString()` renders the server's (UTC) calendar day instead. */
export function formatDateOnlyEt(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "numeric", day: "numeric", year: "numeric" }).format(
    new Date(iso)
  );
}

/** An ISO timestamp -> its date and time in the agency's time zone, e.g. "10/16/2026, 2:05 PM EDT". */
export function formatDateTimeEt(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "numeric",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(iso));
}
