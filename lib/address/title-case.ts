// USPS's Addresses API always returns its standardized form in ALL CAPS
// (its own documented convention) — fine for matching, wrong for anything
// shown to a buyer or partner (PDFs, the dashboard). This renders it in
// normal title case while keeping the handful of token classes that should
// stay uppercase: directionals, the state code, and a leading unit/lot
// number-plus-letter like "2B" or "1121A".

const ALL_CAPS_WORDS = new Set([
  "NE", "NW", "SE", "SW", "N", "S", "E", "W",
  "FL", "US", "PO",
]);

function titleCaseWord(word: string): string {
  if (!word) return word;
  const bare = word.replace(/[^A-Za-z]/g, "");
  if (ALL_CAPS_WORDS.has(bare.toUpperCase())) return word.toUpperCase();
  // An ordinal street number ("94th", "21st", "3rd") reads normally with a
  // lowercase suffix — checked before the lettered-unit rule below, which
  // would otherwise catch it too and uppercase the whole token ("94TH").
  const ordinal = word.match(/^(\d+)(st|nd|rd|th)$/i);
  if (ordinal) return ordinal[1] + ordinal[2]!.toLowerCase();
  // A house-number/unit token like "2004" or "1121A" — keep any trailing
  // letter uppercase (Florida's own convention for a lettered house number).
  if (/^\d+[A-Za-z]*$/.test(word)) return word.toUpperCase();
  return word[0]!.toUpperCase() + word.slice(1).toLowerCase();
}

/** "2004 DARTMOUTH DR" -> "2004 Dartmouth Dr". Safe to call on already-mixed-case input. */
export function titleCaseAddress(value: string): string {
  return value
    .split(" ")
    .map((word) => (word ? titleCaseWord(word) : word))
    .join(" ");
}
