import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PDFDocument, StandardFonts, rgb, type PDFImage } from "pdf-lib";
import { createServiceSupabase } from "@/lib/supabase/server";

export interface GenerateIndicationResult {
  proposalId: string;
  path: string;
  version: number;
}

const PAGE_WIDTH = 612; // 8.5in
const PAGE_HEIGHT = 792; // 11in
const MARGIN = 54;
const FOOTER_RESERVE = 80; // keep the table from colliding with the branded footer

// Brightway Brand Guidelines 2024 color palette (hex -> 0-1 rgb)
const DEEP_BLUE = rgb(0x00 / 255, 0x30 / 255, 0x49 / 255); // #003049
const PERIWINKLE_GREY = rgb(0x82 / 255, 0x91 / 255, 0xac / 255); // #8291AC
const BRIGHT_YELLOW = rgb(0xf0 / 255, 0xff / 255, 0x00 / 255); // #F0FF00
const CREAM = rgb(0xff / 255, 0xff / 255, 0xe6 / 255); // #FFFFE6
const BLACK = rgb(0, 0, 0);
const WHITE = rgb(1, 1, 1);

const BRANDING_DIR = join(process.cwd(), "assets", "branding");
const CARRIER_LOGOS_DIR = join(BRANDING_DIR, "carriers");

// Carrier logo files, added as they're sourced from each carrier's own site.
// Carriers not listed here (or missing their file) fall back to text-only.
const CARRIER_LOGO_FILES: Record<string, string> = {
  Frontline: "frontline.png",
  "Universal P&C": "universal-pc.png",
  "American Integrity": "american-integrity.png",
  "Olympus Insurance": "olympus-insurance.png",
  "Tower Hill Insurance": "tower-hill.png",
  "Florida Peninsula": "florida-peninsula.png",
  "Cabrillo Coastal": "cabrillo-coastal.png",
  "Monarch National": "monarch-national.png",
  "Ovation Home Insurance Exchange": "ovation.png",
  "Patriot Select": "patriot-select.png",
  "Slide Insurance": "slide.png",
};

function formatCurrency(value: number): string {
  return `$${Math.round(value).toLocaleString()}`;
}

/**
 * Builds a one-page indication summary PDF from a property's existing
 * quotes and enrichment data, uploads it to the `proposals` bucket, and
 * records a `proposals` row. Purely reads our own Supabase data — no
 * external network calls.
 */
export async function generateIndicationProposal(propertyId: string): Promise<GenerateIndicationResult> {
  const supabase = createServiceSupabase();

  const { data: property, error: propertyError } = await supabase
    .from("properties")
    .select("*")
    .eq("id", propertyId)
    .single();
  if (propertyError || !property) {
    throw new Error(`Property ${propertyId} not found: ${propertyError?.message ?? "no row"}`);
  }

  const { data: enrichment } = await supabase
    .from("enrichments")
    .select("*")
    .eq("property_id", propertyId)
    .order("fetched_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // premium = 0 (not null) shows up for carrier responses that were actually
  // declined/errored (e.g. an occupancy-type rejection) — exclude those too,
  // not just nulls, so a decline doesn't masquerade as the cheapest option.
  const { data: quotes, error: quotesError } = await supabase
    .from("quotes")
    .select("*")
    .eq("property_id", propertyId)
    .gt("premium", 0)
    .order("premium", { ascending: true });
  if (quotesError) throw new Error(`Failed to load quotes: ${quotesError.message}`);
  if (!quotes?.length) {
    throw new Error(`Property ${propertyId} has no priced quotes to build a proposal from`);
  }

  const { data: existingProposals } = await supabase
    .from("proposals")
    .select("version")
    .eq("property_id", propertyId)
    .order("version", { ascending: false })
    .limit(1);
  const version = (existingProposals?.[0]?.version ?? 0) + 1;

  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const italicFont = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

  const headerLogoBytes = readFileSync(join(BRANDING_DIR, "brightway-harrington-horizontal-deep-blue.png"));
  const headerLogo = await pdfDoc.embedPng(headerLogoBytes);
  const footerMarkBytes = readFileSync(join(BRANDING_DIR, "brightway-mark-deep-blue.png"));
  const footerMark = await pdfDoc.embedPng(footerMarkBytes);

  let y = PAGE_HEIGHT - MARGIN;

  // --- Header: Brightway | The Harrington Agency lockup + contact line + yellow accent rule ---
  // 4x the original 200pt width would be 800pt, wider than the page itself
  // (504pt of content width between margins) — capped to the widest size
  // that still fits cleanly on the page.
  const logoWidth = Math.min(200 * 4, PAGE_WIDTH - 2 * MARGIN - 24);
  const logoHeight = logoWidth * (headerLogo.height / headerLogo.width);
  page.drawImage(headerLogo, { x: MARGIN, y: y - logoHeight, width: logoWidth, height: logoHeight });
  y -= logoHeight + 10;
  page.drawText("727-789-2200  ·  harringtonagency@brightway.com", {
    x: MARGIN,
    y,
    size: 11,
    font: boldFont,
    color: DEEP_BLUE,
  });
  y -= 18;
  page.drawRectangle({ x: MARGIN, y: y - 3, width: PAGE_WIDTH - 2 * MARGIN, height: 3, color: BRIGHT_YELLOW });
  y -= 22;

  page.drawText("Insurance Indication Summary", { x: MARGIN, y, size: 19, font: boldFont, color: DEEP_BLUE });
  y -= 22;
  page.drawText(property.address, { x: MARGIN, y, size: 12, font, color: DEEP_BLUE });
  y -= 15;
  page.drawText(`Prepared by The Harrington Agency  ·  ${new Date().toLocaleDateString()}`, {
    x: MARGIN,
    y,
    size: 9,
    font,
    color: PERIWINKLE_GREY,
  });
  y -= 28;

  function drawSectionHeader(label: string) {
    page.drawRectangle({ x: MARGIN, y: y - 8, width: 8, height: 8, color: BRIGHT_YELLOW });
    page.drawText(label, { x: MARGIN + 14, y: y - 7.5, size: 11, font: boldFont, color: DEEP_BLUE });
    y -= 22;
  }

  // --- Property Snapshot: cream color-blocked panel per brand color usage guide ---
  drawSectionHeader("PROPERTY SNAPSHOT");
  const snapshot = [
    property.year_built ? `Year Built: ${property.year_built}` : null,
    property.sqft ? `Living Area: ${property.sqft.toLocaleString()} sqft` : null,
    property.construction ? `Construction: ${property.construction}` : null,
    property.beds != null && property.baths != null ? `${property.beds} bd / ${property.baths} ba` : null,
    enrichment?.flood_zone ? `Flood Zone: ${enrichment.flood_zone}` : null,
  ].filter((line): line is string => line != null);

  const panelPadding = 12;
  const panelHeight = snapshot.length * 14 + panelPadding * 2 - 4;
  page.drawRectangle({ x: MARGIN, y: y - panelHeight, width: PAGE_WIDTH - 2 * MARGIN, height: panelHeight, color: CREAM });
  let snapshotY = y - panelPadding - 8;
  for (const line of snapshot) {
    page.drawText(line, { x: MARGIN + panelPadding, y: snapshotY, size: 10, font, color: BLACK });
    snapshotY -= 14;
  }
  y -= panelHeight + 24;

  // --- Carrier Indications table ---
  drawSectionHeader("CARRIER INDICATIONS");
  const colCarrier = MARGIN + 10;
  const colForm = MARGIN + 250;
  const colPremium = MARGIN + 350;
  const rowHeight = 22;
  const logoMaxWidth = 70;
  const logoMaxHeight = 16;
  const tableWidth = PAGE_WIDTH - 2 * MARGIN;

  const carrierLogos = new Map<string, PDFImage>();
  for (const carrier of new Set(quotes.map((q) => q.carrier))) {
    const filename = CARRIER_LOGO_FILES[carrier];
    if (!filename) continue;
    const logoPath = join(CARRIER_LOGOS_DIR, filename);
    if (!existsSync(logoPath)) continue;
    carrierLogos.set(carrier, await pdfDoc.embedPng(readFileSync(logoPath)));
  }

  // HO3 options first (most homeowners want HO3, not the DP3 dwelling-fire
  // form), cheapest-to-most-expensive within each form.
  const formRank = (form: string | null) => (form === "HO3" ? 0 : form === "DP3" ? 1 : 2);
  const displayQuotes = [...quotes].sort(
    (a, b) => formRank(a.form_type) - formRank(b.form_type) || Number(a.premium) - Number(b.premium)
  );
  const bestQuoteId = quotes.reduce((best, q) => (Number(q.premium) < Number(best.premium) ? q : best)).id;

  page.drawRectangle({ x: MARGIN, y: y - rowHeight, width: tableWidth, height: rowHeight, color: DEEP_BLUE });
  page.drawText("Carrier", { x: colCarrier, y: y - 15, size: 10, font: boldFont, color: WHITE });
  page.drawText("Form", { x: colForm, y: y - 15, size: 10, font: boldFont, color: WHITE });
  page.drawText("Annual Premium", { x: colPremium, y: y - 15, size: 10, font: boldFont, color: WHITE });
  y -= rowHeight;

  displayQuotes.forEach((quote, i) => {
    if (y < MARGIN + FOOTER_RESERVE) return; // stay on one page
    const rowTop = y;
    if (i % 2 === 1) {
      page.drawRectangle({ x: MARGIN, y: rowTop - rowHeight, width: tableWidth, height: rowHeight, color: CREAM });
    }
    const isBest = quote.id === bestQuoteId;
    if (isBest) {
      // Best value: a small bright-yellow marker, per brand guidance to use
      // yellow sparingly to highlight the most important line.
      page.drawRectangle({ x: MARGIN, y: rowTop - rowHeight, width: 3, height: rowHeight, color: BRIGHT_YELLOW });
    }
    const textY = rowTop - 15;
    const carrierFont = isBest ? boldFont : font;

    let carrierTextX = colCarrier;
    const logo = carrierLogos.get(quote.carrier);
    if (logo) {
      let logoWidth = logoMaxWidth;
      let logoHeight = logoWidth * (logo.height / logo.width);
      if (logoHeight > logoMaxHeight) {
        logoHeight = logoMaxHeight;
        logoWidth = logoHeight * (logo.width / logo.height);
      }
      page.drawImage(logo, { x: colCarrier, y: rowTop - rowHeight / 2 - logoHeight / 2, width: logoWidth, height: logoHeight });
      carrierTextX = colCarrier + logoMaxWidth + 8;
    }

    page.drawText(quote.carrier, { x: carrierTextX, y: textY, size: 10, font: carrierFont, color: BLACK });
    page.drawText(quote.form_type ?? "-", { x: colForm, y: textY, size: 10, font: carrierFont, color: BLACK });
    page.drawText(formatCurrency(Number(quote.premium)), { x: colPremium, y: textY, size: 10, font: carrierFont, color: DEEP_BLUE });
    y -= rowHeight;
  });

  // --- Footer: rule, brand mark, disclaimers, tagline ---
  const footerY = MARGIN + 44;
  page.drawRectangle({ x: MARGIN, y: footerY, width: PAGE_WIDTH - 2 * MARGIN, height: 0.75, color: PERIWINKLE_GREY });

  const markSize = 14;
  page.drawImage(footerMark, { x: MARGIN, y: footerY - 34, width: markSize, height: markSize });
  page.drawText(
    "All premiums shown are indicative estimates only, based on a placeholder applicant profile.",
    { x: MARGIN + markSize + 8, y: footerY - 14, size: 8, font, color: PERIWINKLE_GREY }
  );
  page.drawText(
    "Actual bindable premiums require a full application and are subject to underwriting.",
    { x: MARGIN + markSize + 8, y: footerY - 25, size: 8, font, color: PERIWINKLE_GREY }
  );
  page.drawText("The brighter way to do insurance.", {
    x: MARGIN + markSize + 8,
    y: footerY - 36,
    size: 8,
    font: italicFont,
    color: DEEP_BLUE,
  });

  const pdfBytes = await pdfDoc.save();
  const path = `${property.agency_id}/${propertyId}/indication-v${version}.pdf`;

  const { error: uploadError } = await supabase.storage
    .from("proposals")
    .upload(path, pdfBytes, { contentType: "application/pdf", upsert: true });
  if (uploadError) throw new Error(`Failed to upload proposal PDF: ${uploadError.message}`);

  const { data: proposal, error: insertError } = await supabase
    .from("proposals")
    .insert({ agency_id: property.agency_id, property_id: propertyId, kind: "indication", pdf_path: path, version })
    .select("id")
    .single();
  if (insertError || !proposal) {
    throw new Error(`Failed to record proposal row: ${insertError?.message ?? "no row returned"}`);
  }

  return { proposalId: proposal.id, path, version };
}
