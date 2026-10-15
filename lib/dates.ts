/** Today's date (YYYY-MM-DD) in the agency's time zone — a bare `new Date().toISOString()` flips to tomorrow every evening. */
export function todayEt(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
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
