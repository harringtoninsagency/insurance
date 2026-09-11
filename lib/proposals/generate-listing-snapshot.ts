import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PDFDocument, StandardFonts, rgb, type PDFImage } from "pdf-lib";
import { createServiceSupabase } from "@/lib/supabase/server";

export interface GenerateListingSnapshotResult {
  proposalId: string;
  path: string;
  version: number;
}

const PAGE_WIDTH = 612; // 8.5in
const PAGE_HEIGHT = 792; // 11in
const MARGIN = 54;
const CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN;

// Brightway Brand Guidelines 2024 color palette (hex -> 0-1 rgb) — same
// palette as generate-indication.ts.
const DEEP_BLUE = rgb(0x00 / 255, 0x30 / 255, 0x49 / 255); // #003049
const PERIWINKLE_GREY = rgb(0x82 / 255, 0x91 / 255, 0xac / 255); // #8291AC
const BRIGHT_YELLOW = rgb(0xf0 / 255, 0xff / 255, 0x00 / 255); // #F0FF00
const CREAM = rgb(0xff / 255, 0xff / 255, 0xe6 / 255); // #FFFFE6
const LIGHT_GREY = rgb(0xf1 / 255, 0xf5 / 255, 0xf9 / 255);
const GREEN = rgb(0x16 / 255, 0xa3 / 255, 0x4a / 255);
const AMBER = rgb(0xd9 / 255, 0x8c / 255, 0x0d / 255);
const BLACK = rgb(0, 0, 0);
const WHITE = rgb(1, 1, 1);

const BRANDING_DIR = join(process.cwd(), "assets", "branding");
const CARRIER_LOGOS_DIR = join(BRANDING_DIR, "carriers");

// Same carrier -> logo filename map as generate-indication.ts. Carriers not
// listed here (or missing their file) fall back to text-only.
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

// Static advisory checklist — every reference layout shows the same values
// regardless of the property. Computing these for real (e.g. from wind-mit
// credits or a 4-point-inspection rule engine) is a separate feature; this
// is deliberately just the boilerplate "here's what's still ahead" list a
// producer would say to any new-listing buyer.
const STATIC_READINESS_ITEMS: Array<{ label: string; status: string }> = [
  { label: "Roof documentation", status: "Needs verification" },
  { label: "4-point inspection", status: "May be required" },
  { label: "Wind mitigation", status: "Recommended" },
  { label: "Flood insurance", status: "Separate review" },
  { label: "Final eligibility", status: "Underwriting review" },
];

function formatCurrency(value: number): string {
  return `$${Math.round(value).toLocaleString()}`;
}

interface QuoteRow {
  id: string;
  carrier: string;
  form_type: string | null;
  premium: string | number;
}

function sniffImageKind(bytes: Uint8Array): "jpg" | "png" {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  return "jpg"; // JPEG (FF D8) is the only other type uploadListingPhoto accepts
}

/**
 * Builds the buyer-facing "New Listing Insurance Snapshot" PDF — a richer,
 * photo-led sibling to generate-indication.ts aimed at a prospective buyer
 * rather than the listing agent, from the same quotes/property data.
 */
export async function generateListingSnapshotProposal(propertyId: string): Promise<GenerateListingSnapshotResult> {
  const supabase = createServiceSupabase();

  const { data: property, error: propertyError } = await supabase
    .from("properties")
    .select("*")
    .eq("id", propertyId)
    .single();
  if (propertyError || !property) {
    throw new Error(`Property ${propertyId} not found: ${propertyError?.message ?? "no row"}`);
  }

  const { data: quotes, error: quotesError } = await supabase
    .from("quotes")
    .select("id, carrier, form_type, premium")
    .eq("property_id", propertyId)
    .gt("premium", 0)
    .order("premium", { ascending: true });
  if (quotesError) throw new Error(`Failed to load quotes: ${quotesError.message}`);

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

  let y = PAGE_HEIGHT - MARGIN;

  // --- Header: logo + contact line + yellow accent rule ---
  // This layout has far more sections below than generate-indication.ts, so
  // (unlike that one) the logo stays close to its native size rather than
  // scaled up — there isn't page budget to spare for an oversized header.
  const logoWidth = Math.min(180, CONTENT_WIDTH - 24);
  const logoHeight = logoWidth * (headerLogo.height / headerLogo.width);
  page.drawImage(headerLogo, { x: MARGIN, y: y - logoHeight, width: logoWidth, height: logoHeight });
  y -= logoHeight + 8;
  page.drawText("727-789-2200  ·  harringtonagency@brightway.com", {
    x: MARGIN,
    y,
    size: 10,
    font: boldFont,
    color: DEEP_BLUE,
  });
  y -= 14;
  page.drawRectangle({ x: MARGIN, y: y - 3, width: CONTENT_WIDTH, height: 3, color: BRIGHT_YELLOW });
  y -= 20;

  page.drawText("NEW LISTING INSURANCE SNAPSHOT", { x: MARGIN, y, size: 18, font: boldFont, color: DEEP_BLUE });
  y -= 18;
  page.drawText(property.address, { x: MARGIN, y, size: 12, font: boldFont, color: rgb(0x1c / 255, 0x64 / 255, 0x8b / 255) });
  y -= 13;
  page.drawText(`Preliminary insurance review for a new MLS listing  |  Prepared ${new Date().toLocaleDateString()}`, {
    x: MARGIN,
    y,
    size: 8.5,
    font,
    color: PERIWINKLE_GREY,
  });
  y -= 18;

  // --- Photo box (left) + starting-indication box (right) ---
  const photoWidth = 300;
  const boxGap = 18;
  const indicationWidth = CONTENT_WIDTH - photoWidth - boxGap;
  const rowHeight = 150;
  const rowTop = y;

  if (property.photo_path) {
    const { data: photoBlob, error: photoError } = await supabase.storage
      .from("listing-photos")
      .download(property.photo_path);
    if (photoError || !photoBlob) {
      throw new Error(`Failed to download listing photo: ${photoError?.message ?? "no data"}`);
    }
    const photoBytes = new Uint8Array(await photoBlob.arrayBuffer());
    const photoImage = sniffImageKind(photoBytes) === "png" ? await pdfDoc.embedPng(photoBytes) : await pdfDoc.embedJpg(photoBytes);

    // Contain-fit into the box, centered. A true cover-crop would need a
    // pdf-lib clip path to keep the image from overflowing the box, which
    // isn't worth the complexity here — a letterboxed photo is a fine
    // trade-off for guaranteed-correct output.
    const boxAspect = photoWidth / rowHeight;
    const imgAspect = photoImage.width / photoImage.height;
    let drawWidth = photoWidth;
    let drawHeight = rowHeight;
    if (imgAspect > boxAspect) {
      drawWidth = photoWidth;
      drawHeight = photoWidth / imgAspect;
    } else {
      drawHeight = rowHeight;
      drawWidth = rowHeight * imgAspect;
    }
    const offsetX = (photoWidth - drawWidth) / 2;
    const offsetY = (rowHeight - drawHeight) / 2;
    page.drawRectangle({ x: MARGIN, y: rowTop - rowHeight, width: photoWidth, height: rowHeight, color: WHITE });
    page.drawImage(photoImage, {
      x: MARGIN + offsetX,
      y: rowTop - rowHeight + offsetY,
      width: drawWidth,
      height: drawHeight,
    });
  } else {
    page.drawRectangle({
      x: MARGIN,
      y: rowTop - rowHeight,
      width: photoWidth,
      height: rowHeight,
      borderColor: PERIWINKLE_GREY,
      borderWidth: 1,
      borderDashArray: [4, 4],
      color: rgb(0.98, 0.99, 1),
    });
    const centerX = MARGIN + photoWidth / 2;
    const centerY = rowTop - rowHeight / 2;
    const placeholderLines = ["HOME PHOTO", "Replace with MLS or listing photo", "Recommended crop: 16:9"];
    const placeholderSizes = [14, 9, 9];
    let placeholderY = centerY + 10;
    placeholderLines.forEach((line, i) => {
      const size = placeholderSizes[i]!;
      const usedFont = i === 0 ? boldFont : font;
      const textWidth = usedFont.widthOfTextAtSize(line, size);
      page.drawText(line, { x: centerX - textWidth / 2, y: placeholderY, size, font: usedFont, color: PERIWINKLE_GREY });
      placeholderY -= 16;
    });
  }

  // Prefer the cheapest HO3 quote for the headline number — HO3 is the form
  // most homeowners want, so leading with a cheaper DP3 (dwelling-fire) quote
  // would be a misleading "starting" price. Falls back to the cheapest quote
  // of any form if no HO3 quote exists at all.
  const cheapestHo3 = (quotes as QuoteRow[] | null)?.find((q) => q.form_type === "HO3");
  const bestQuote = cheapestHo3 ?? quotes?.[0];
  const indicationX = MARGIN + photoWidth + boxGap;
  page.drawRectangle({ x: indicationX, y: rowTop - rowHeight, width: indicationWidth, height: rowHeight, color: DEEP_BLUE });
  let boxY = rowTop - 22;
  const boxPad = 14;
  page.drawText(
    bestQuote ? `PRELIMINARY ${bestQuote.form_type ?? "HO3"}` : "PRELIMINARY",
    { x: indicationX + boxPad, y: boxY, size: 9, font: boldFont, color: BRIGHT_YELLOW }
  );
  boxY -= 12;
  page.drawText("STARTING INDICATION", { x: indicationX + boxPad, y: boxY, size: 9, font: boldFont, color: WHITE });
  boxY -= 38;
  page.drawText(bestQuote ? formatCurrency(Number(bestQuote.premium)) : "—", {
    x: indicationX + boxPad,
    y: boxY,
    size: 30,
    font: boldFont,
    color: WHITE,
  });
  boxY -= 16;
  page.drawText("estimated annual premium", { x: indicationX + boxPad, y: boxY, size: 8, font, color: rgb(0.85, 0.88, 0.92) });
  boxY -= 14;
  page.drawRectangle({ x: indicationX + boxPad, y: boxY, width: indicationWidth - boxPad * 2, height: 0.75, color: PERIWINKLE_GREY });
  boxY -= 18;
  page.drawText("Markets found:", { x: indicationX + boxPad, y: boxY, size: 9, font, color: WHITE });
  page.drawText(quotes?.length ? "YES" : "NO", {
    x: indicationX + boxPad + font.widthOfTextAtSize("Markets found: ", 9),
    y: boxY,
    size: 9,
    font: boldFont,
    color: BRIGHT_YELLOW,
  });
  boxY -= 13;
  page.drawText("Subject to application and underwriting", { x: indicationX + boxPad, y: boxY, size: 7.5, font, color: rgb(0.75, 0.79, 0.85) });

  y = rowTop - rowHeight - 14;

  function drawSectionHeader(label: string) {
    page.drawText(label, { x: MARGIN, y, size: 10.5, font: boldFont, color: DEEP_BLUE });
    y -= 14;
  }

  // --- Property at a glance: 4 equal boxes ---
  drawSectionHeader("PROPERTY AT A GLANCE");
  const glanceItems = [
    { label: "YEAR BUILT", value: property.year_built ? String(property.year_built) : "—" },
    { label: "LIVING AREA", value: property.sqft ? `${property.sqft.toLocaleString()} sq. ft.` : "—" },
    { label: "CONSTRUCTION", value: property.construction ?? "—" },
    {
      label: "LAYOUT",
      value: property.beds != null && property.baths != null ? `${property.beds} bed / ${property.baths} bath` : "—",
    },
  ];
  const glanceGap = 10;
  const glanceWidth = (CONTENT_WIDTH - glanceGap * 3) / 4;
  const glanceHeight = 36;
  glanceItems.forEach((item, i) => {
    const x = MARGIN + i * (glanceWidth + glanceGap);
    page.drawRectangle({ x, y: y - glanceHeight, width: glanceWidth, height: glanceHeight, color: LIGHT_GREY });
    page.drawText(item.label, { x: x + 10, y: y - 14, size: 7, font: boldFont, color: PERIWINKLE_GREY });
    page.drawText(item.value, { x: x + 10, y: y - 28, size: 10, font: boldFont, color: DEEP_BLUE });
  });
  y -= glanceHeight + 12;

  // --- Insurance readiness: 2-column checklist ---
  drawSectionHeader("INSURANCE READINESS");
  const marketsFound = !!quotes?.length;
  const readinessItems = [
    { label: "Preliminary markets", status: marketsFound ? "Options identified" : "Not yet found", ok: marketsFound },
    ...STATIC_READINESS_ITEMS.map((item) => ({ ...item, ok: false })),
  ];
  const colGap = 24;
  const readinessColWidth = (CONTENT_WIDTH - colGap) / 2;
  const readinessRowHeight = 18;
  const rowsPerCol = Math.ceil(readinessItems.length / 2);
  readinessItems.forEach((item, i) => {
    const col = Math.floor(i / rowsPerCol);
    const row = i % rowsPerCol;
    const x = MARGIN + col * (readinessColWidth + colGap);
    const itemY = y - row * readinessRowHeight;
    const dotColor = item.ok ? GREEN : AMBER;
    page.drawEllipse({ x: x + 4, y: itemY - 3, xScale: 4, yScale: 4, color: dotColor });
    page.drawText(item.label, { x: x + 14, y: itemY - 7, size: 9, font, color: rgb(0.3, 0.35, 0.4) });
    const statusX = x + 130;
    page.drawText(item.status, { x: statusX, y: itemY - 7, size: 9, font: boldFont, color: DEEP_BLUE });
  });
  y -= rowsPerCol * readinessRowHeight + 6;

  // --- Preliminary carrier indications table ---
  drawSectionHeader("PRELIMINARY CARRIER INDICATIONS");
  const ho3Quotes = ((quotes ?? []) as QuoteRow[]).filter((q) => q.form_type === "HO3");
  const dp3Quotes = ((quotes ?? []) as QuoteRow[]).filter((q) => q.form_type === "DP3");
  const topHo3 = ho3Quotes.slice(0, 5);
  const additionalHo3 = ho3Quotes.slice(5);
  const topDp3 = dp3Quotes.slice(0, 3);

  const colCarrier = MARGIN + 10;
  const colForm = MARGIN + 320;
  const colPremium = MARGIN + 420;
  const tableRowHeight = 20;
  const logoMaxWidth = 70;
  const logoMaxHeight = 13;

  const carrierLogos = new Map<string, PDFImage>();
  for (const carrier of new Set(topHo3.map((q) => q.carrier))) {
    const filename = CARRIER_LOGO_FILES[carrier];
    if (!filename) continue;
    const logoPath = join(CARRIER_LOGOS_DIR, filename);
    if (!existsSync(logoPath)) continue;
    carrierLogos.set(carrier, await pdfDoc.embedPng(readFileSync(logoPath)));
  }

  // Reserve space below the table for the two condensed lines, the "have an
  // interested buyer" callout, and the footer, so a longer carrier list
  // degrades by skipping rows rather than overlapping the footer.
  const FOOTER_RESERVE = 108;

  page.drawRectangle({ x: MARGIN, y: y - tableRowHeight, width: CONTENT_WIDTH, height: tableRowHeight, color: DEEP_BLUE });
  page.drawText("CARRIER", { x: colCarrier, y: y - 13.5, size: 9, font: boldFont, color: WHITE });
  page.drawText("FORM", { x: colForm, y: y - 13.5, size: 9, font: boldFont, color: WHITE });
  page.drawText("ANNUAL", { x: colPremium, y: y - 13.5, size: 9, font: boldFont, color: WHITE });
  y -= tableRowHeight;

  topHo3.forEach((quote, i) => {
    if (y < MARGIN + FOOTER_RESERVE) return; // stay on one page
    const rowTop2 = y;
    if (i === 0) {
      page.drawRectangle({ x: MARGIN, y: rowTop2 - tableRowHeight, width: CONTENT_WIDTH, height: tableRowHeight, color: CREAM });
      page.drawRectangle({ x: MARGIN, y: rowTop2 - tableRowHeight, width: 3, height: tableRowHeight, color: BRIGHT_YELLOW });
    }
    const textY = rowTop2 - 13.5;
    const carrierFont = i === 0 ? boldFont : font;

    let carrierTextX = colCarrier;
    const logo = carrierLogos.get(quote.carrier);
    if (logo) {
      let lw = logoMaxWidth;
      let lh = lw * (logo.height / logo.width);
      if (lh > logoMaxHeight) {
        lh = logoMaxHeight;
        lw = lh * (logo.width / logo.height);
      }
      page.drawImage(logo, { x: colCarrier, y: rowTop2 - tableRowHeight / 2 - lh / 2, width: lw, height: lh });
      carrierTextX = colCarrier + logoMaxWidth + 8;
    }
    page.drawText(quote.carrier, { x: carrierTextX, y: textY, size: 9.5, font: carrierFont, color: BLACK });
    page.drawText(quote.form_type ?? "-", { x: colForm, y: textY, size: 9.5, font: carrierFont, color: BLACK });
    page.drawText(formatCurrency(Number(quote.premium)), { x: colPremium, y: textY, size: 9.5, font: carrierFont, color: DEEP_BLUE });
    y -= tableRowHeight;
    if (i > 0) {
      page.drawRectangle({ x: MARGIN, y, width: CONTENT_WIDTH, height: 0.5, color: rgb(0.9, 0.9, 0.9) });
    }
  });

  y -= 4;
  function drawCondensedLine(label: string, condensedQuotes: QuoteRow[]) {
    if (!condensedQuotes.length) return;
    const parts = condensedQuotes.map((q) => `${q.carrier} ${formatCurrency(Number(q.premium))}`).join("  |  ");
    page.drawText(`${label}: ${parts}`, { x: MARGIN, y, size: 8, font, color: rgb(0.4, 0.45, 0.5) });
    y -= 11;
  }
  drawCondensedLine("Additional HO3 indications", additionalHo3);
  drawCondensedLine("DP3 indications", topDp3);
  y -= 8;

  // --- "Have an interested buyer?" callout ---
  const calloutHeight = 36;
  page.drawRectangle({
    x: MARGIN,
    y: y - calloutHeight,
    width: CONTENT_WIDTH,
    height: calloutHeight,
    color: CREAM,
    borderColor: BRIGHT_YELLOW,
    borderWidth: 1.5,
  });
  page.drawText("HAVE AN INTERESTED BUYER?", { x: MARGIN + 14, y: y - 15, size: 9, font: boldFont, color: DEEP_BLUE });
  page.drawText("Send us the buyer's name, closing date and contact information for a personalized proposal.", {
    x: MARGIN + 14,
    y: y - 27,
    size: 8,
    font,
    color: rgb(0.3, 0.35, 0.4),
  });

  // --- Footer ---
  const footerY = MARGIN + 30;
  page.drawRectangle({ x: MARGIN, y: footerY, width: CONTENT_WIDTH, height: 0.75, color: PERIWINKLE_GREY });
  page.drawText(
    "Indicative estimates only, based on a placeholder applicant profile. Final premiums require a full application and",
    { x: MARGIN, y: footerY - 14, size: 7.5, font, color: PERIWINKLE_GREY }
  );
  page.drawText("are subject to underwriting, inspections, property documentation, coverage selections and applicant details.", {
    x: MARGIN,
    y: footerY - 24,
    size: 7.5,
    font,
    color: PERIWINKLE_GREY,
  });
  const tagline = "The brighter way to do insurance.";
  const taglineWidth = italicFont.widthOfTextAtSize(tagline, 9);
  page.drawText(tagline, { x: PAGE_WIDTH - MARGIN - taglineWidth, y: footerY - 36, size: 9, font: italicFont, color: DEEP_BLUE });

  const pdfBytes = await pdfDoc.save();
  const path = `${property.agency_id}/${propertyId}/listing-snapshot-v${version}.pdf`;

  const { error: uploadError } = await supabase.storage
    .from("proposals")
    .upload(path, pdfBytes, { contentType: "application/pdf", upsert: true });
  if (uploadError) throw new Error(`Failed to upload proposal PDF: ${uploadError.message}`);

  const { data: proposal, error: insertError } = await supabase
    .from("proposals")
    .insert({ agency_id: property.agency_id, property_id: propertyId, kind: "listing_snapshot", pdf_path: path, version })
    .select("id")
    .single();
  if (insertError || !proposal) {
    throw new Error(`Failed to record proposal row: ${insertError?.message ?? "no row returned"}`);
  }

  return { proposalId: proposal.id, path, version };
}
