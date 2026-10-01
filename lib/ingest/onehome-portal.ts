import { chromium } from "playwright";
import type { ParsedListing, ListingPhoto } from "@/lib/ingest/onehome-email";

// Parses the full "Browse Properties" results page on portal.onehome.com —
// the page behind a saved search's "View All Properties"/"N new or updated"
// link, which shows every matching listing (dozens), not just the ~10
// OneHome inlines in the email itself. Deliberately separate from
// onehome-email.ts: different source (a rendered Angular SPA page, not an
// email body) and a different HTML template, even though both ultimately
// produce the same ParsedListing shape.
//
// Real markup observed on this page per listing tile (Angular, scoped
// `_ngcontent-*` attributes and `<!---->` comment placeholders omitted below
// for clarity):
//   <p class="price"><span><span> $365,000 <aotf-currency>...</aotf-currency></span></span></p>
//   <p class="subtype"><span> Single Family Residence</span></p>
//   <div class="address-content"><address><a href="...">
//     <p>715 W BAYSHORE Drive</p>
//     <p>Tarpon Springs, FL 34689-2412</p>
//   </a></address>
//     <div class="features"><ul class="items">
//       <li> 3 <abbr title="bedrooms">bd</abbr></li>
//       <li> 2 <abbr title="bathrooms">ba</abbr></li>
//       <li> 1,216 sqft </li>
//     </ul></div>
//     <div class="mls"><p><span>MLS #</span>TB8549015 </p></div>
//   </div>

const MLS_TILE_END_RE = /class="mls"[\s\S]*?<span[^>]*>\s*MLS\s*#\s*<\/span>\s*([A-Z0-9]+)/gi;

function fieldText(window: string, className: string): string | null {
  const re = new RegExp(`class="${className}"[^>]*>([\\s\\S]*?)<\\/(?:p|div)>`, "i");
  const match = window.match(re)?.[1];
  if (!match) return null;
  // Strip any nested tags (e.g. <span>, <aotf-currency>) and comment placeholders, collapse whitespace.
  return match.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Splits the page HTML into one window per listing tile — each window runs
 * from just after the previous tile's "MLS #..." (or the start of the
 * document, for the first tile) through and including this tile's own
 * "MLS #...", so every window is self-contained (price/subtype/address/
 * features/mls for exactly one listing) regardless of Angular's comment
 * placeholder noise between fields.
 */
function listingTileWindows(html: string): string[] {
  const matches = [...html.matchAll(MLS_TILE_END_RE)];
  const windows: string[] = [];
  let previousEnd = 0;
  for (const match of matches) {
    const end = (match.index ?? 0) + match[0].length;
    windows.push(html.slice(previousEnd, end));
    previousEnd = end;
  }
  return windows;
}

export function parseOneHomePortalHtml(html: string): ParsedListing[] {
  const listings: ParsedListing[] = [];

  for (const window of listingTileWindows(html)) {
    const priceText = fieldText(window, "price");
    const propertyType = fieldText(window, "subtype");
    const addressParagraphs = window.match(/class="address-content"[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i)?.[1];
    const addressLines = addressParagraphs
      ? [...addressParagraphs.matchAll(/<p[^>]*>([^<]+)<\/p>/gi)].map((m) => m[1]!.trim())
      : [];
    const mlsId = window.match(/MLS\s*#\s*<\/span>\s*([A-Z0-9]+)/i)?.[1];

    const price = priceText?.match(/\$?\s*([\d,]+)/)?.[1];
    const streetAddress = addressLines[0];
    const cityMatch = addressLines[1]?.match(/^([A-Za-z .'-]+),\s*([A-Z]{2})\s+(\d{5})(?:-\d{4})?$/);
    const beds = window.match(/>\s*([\d.]+)\s*<abbr[^>]*title="bedrooms"/i)?.[1];
    const baths = window.match(/>\s*([\d.]+)\s*<abbr[^>]*title="bathrooms"/i)?.[1];
    const sqft = window.match(/<li[^>]*>\s*([\d,]+)\s*sqft/i)?.[1];

    if (!price || !propertyType || !streetAddress || !cityMatch || !beds || !baths || !sqft || !mlsId) {
      console.warn("Skipping unparseable portal listing tile near MLS:", mlsId ?? "(none found)");
      continue;
    }

    listings.push({
      listPrice: Number(price.replace(/,/g, "")),
      propertyType,
      streetAddress,
      city: cityMatch[1]!.trim(),
      state: cityMatch[2]!,
      zip: cityMatch[3]!,
      beds: Number(beds),
      baths: Number(baths),
      sqft: Number(sqft.replace(/,/g, "")),
      mlsId: mlsId.toUpperCase(),
    });
  }

  return listings;
}

/**
 * Pulls each listing's photo out of the same per-tile windows
 * `parseOneHomePortalHtml` uses — every tile carries exactly one
 * `class="feature-pic"` <img> (confirmed live across both the "list" and
 * "map" view templates this page can render; the photo CDN here is
 * api.cotality.com, a different host than the email HTML's
 * media.stellar.mlsmatrix.com, so this needs its own extraction rather than
 * reusing `extractListingPhotos`). These URLs carry a short-lived signed
 * token (observed ~30 minute expiry) — download promptly after scraping,
 * same as `applyOneHomePhotos` already does for email photos.
 */
export function extractPortalPhotos(html: string): ListingPhoto[] {
  const photos: ListingPhoto[] = [];
  for (const window of listingTileWindows(html)) {
    const mlsId = window.match(/MLS\s*#\s*<\/span>\s*([A-Z0-9]+)/i)?.[1];
    const url = window.match(/class="feature-pic"[^>]*\bsrc="([^"]+)"/i)?.[1];
    if (mlsId && url) photos.push({ mlsId: mlsId.toUpperCase(), url });
  }
  return photos;
}

/**
 * Pulls the "View All Properties"/"N new or updated listings" portal link
 * out of a OneHome saved-search email's HTML — the same link a person would
 * click to see every matching listing, not just the ~10 inlined as
 * "Highlights" in the email itself.
 */
export function extractPortalUrl(emailHtml: string): string | null {
  const match = emailHtml.match(/href="(https:\/\/portal\.onehome\.com[^"]*)"[^>]*>\s*(?:<[^>]*>\s*)*View All Properties/i);
  return match ? match[1]!.replace(/&amp;/g, "&") : null;
}

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

export interface PortalScrapeResult {
  listings: ParsedListing[];
  photos: ListingPhoto[];
}

/**
 * Loads the full saved-search results page behind a portal URL and returns
 * every listing on it (with photos) — not just the handful OneHome
 * highlights by email. Needs a real browser: this page sits behind Incapsula
 * bot-detection and returns only an empty Angular shell to a plain HTTP
 * request (confirmed live — no JS execution, no listing data at all).
 * Headless Chromium via Playwright does get through it (confirmed live,
 * repeatedly), but this is inherently less certain to keep working than the
 * official bulk-data channels used elsewhere in this project (PCPAO, Pasco,
 * DOR) — if this starts failing, that's the most likely reason, not a bug in
 * the click loop below.
 *
 * The app renders this page as one of a few different view templates (seen
 * live: "list" and "map", chosen somewhat inconsistently run to run) — all
 * of them carry the same `class="price"`/`class="mls"`/`class="feature-pic"`
 * markup `parseOneHomePortalHtml`/`extractPortalPhotos` key off, so this
 * works regardless of which one a given run lands on without needing to
 * force a specific view.
 */
export async function scrapePortalListings(portalUrl: string): Promise<PortalScrapeResult> {
  // The cloud routine's sandbox blocks Playwright's own browser download
  // (cdn.playwright.dev isn't reachable there, confirmed live, repeatedly —
  // unlike a specific SaaS API host, this is a large third-party binary
  // fetch the sandbox's network policy doesn't allow at all). Use the
  // system's own apt-installed Chromium there instead — see the setup
  // script in docs/process-onehome-listings.md, which installs it via
  // `apt-get install chromium` (already proven to work in that sandbox,
  // unlike cdn.playwright.dev) and sets this env var to its path. Locally,
  // this var is unset and Playwright's own bundled browser is used as normal.
  const executablePath = process.env.CHROMIUM_EXECUTABLE_PATH || undefined;
  const browser = await chromium.launch({ headless: true, executablePath });
  try {
    const page = await browser.newPage({ userAgent: USER_AGENT });
    await page.goto(portalUrl, { waitUntil: "networkidle", timeout: 30_000 });
    await page.waitForTimeout(3_000);

    // Click "LOAD MORE" until it's gone or a click stops adding new tiles
    // (whichever comes first) — capped at 20 clicks as a sanity bound, well
    // above what a ~100-listing saved search should ever need.
    let previousTileCount = 0;
    for (let i = 0; i < 20; i++) {
      const loadMore = page.getByText("LOAD MORE", { exact: true });
      const visible = await loadMore.isVisible().catch(() => false);
      if (!visible) break;
      await loadMore.click();
      await page.waitForTimeout(1_500);
      const tileCount = (await page.content()).match(/class="mls"/g)?.length ?? 0;
      if (tileCount === previousTileCount) break;
      previousTileCount = tileCount;
    }

    const html = await page.content();
    return { listings: parseOneHomePortalHtml(html), photos: extractPortalPhotos(html) };
  } finally {
    await browser.close();
  }
}
