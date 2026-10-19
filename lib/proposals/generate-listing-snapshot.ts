import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PDFDocument, StandardFonts, rgb, type PDFImage } from "pdf-lib";
import { createServiceSupabase } from "@/lib/supabase/server";
import { resolveCoverages } from "@/lib/quotes/coverage";
import type { ReferralPartnerInfo } from "@/lib/quote-requests/referral-partner";
import { resolveProposalAgent } from "@/lib/quote-requests/proposal-agent";
import { todayEt, formatDateOnly } from "@/lib/dates";
import { titleCaseAddress } from "@/lib/address/title-case";

const AGENT_SECTION_HEIGHT = 76;
// Margin above the logo specifically (1/2in) — independent of the body
// MARGIN below, which stays as-is for left/right/bottom content.
const LOGO_TOP_MARGIN = 36;

export interface GenerateListingSnapshotResult {
  proposalId: string;
  path: string;
  version: number;
}

const PAGE_WIDTH = 612; // 8.5in
const PAGE_HEIGHT = 792; // 11in
const MARGIN = 40;
const CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN;

// Brightway Brand Guidelines 2024 color palette (hex -> 0-1 rgb) — same
// palette as generate-indication.ts.
const DEEP_BLUE = rgb(0x00 / 255, 0x30 / 255, 0x49 / 255); // #003049
const PERIWINKLE_GREY = rgb(0x82 / 255, 0x91 / 255, 0xac / 255); // #8291AC
const BRIGHT_YELLOW = rgb(0xf0 / 255, 0xff / 255, 0x00 / 255); // #F0FF00
const CREAM = rgb(0xff / 255, 0xff / 255, 0xe6 / 255); // #FFFFE6
const LIGHT_GREY = rgb(0xf1 / 255, 0xf5 / 255, 0xf9 / 255);
const BLACK = rgb(0, 0, 0);
const WHITE = rgb(1, 1, 1);

// The agency's one office line with its one shared extension — every agent's
// calls route through this same number/extension, not a per-agent one.
const AGENT_PHONE = "727-789-2200 X.1";

const BRANDING_DIR = join(process.cwd(), "assets", "branding");
const CARRIER_LOGOS_DIR = join(BRANDING_DIR, "carriers");

// Same carrier -> logo filename map as generate-indication.ts. Carriers not
// listed here (or missing their file) fall back to text-only.
const CARRIER_LOGO_FILES: Record<string, string> = {
  Frontline: "frontline.png",
  "Universal P&C": "universal-pc.png",
  "American Integrity": "american-integrity.png",
  "Olympus Insurance": "olympus-insurance.png",
  "Edison Insurance": "edison-insurance.png",
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
/**
 * `referralPartner`, when given, credits the realtor/mortgage broker who
 * requested this snapshot with a compact line under the header. Omit it (the
 * default) and the layout is exactly what it always was — see the matching
 * note in lib/proposals/generate-indication.ts.
 */
export async function generateListingSnapshotProposal(
  propertyId: string,
  referralPartner?: ReferralPartnerInfo | null,
  quoteRequestId?: string | null
): Promise<GenerateListingSnapshotResult> {
  const supabase = createServiceSupabase();
  const agent = await resolveProposalAgent(propertyId, quoteRequestId);

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
    .select("id, carrier, form_type, premium, coverages")
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

  let y = PAGE_HEIGHT - LOGO_TOP_MARGIN;

  // --- Header: logo (3x native size, per brand emphasis for this
  // buyer-facing document), title, then the yellow accent rule below the
  // title (not between the logo and title).
  const logoWidth = Math.min(180 * 3, CONTENT_WIDTH);
  const logoHeight = logoWidth * (headerLogo.height / headerLogo.width);
  page.drawImage(headerLogo, { x: MARGIN, y: y - logoHeight, width: logoWidth, height: logoHeight });
  y -= logoHeight + 14;

  page.drawText("NEW LISTING INSURANCE SNAPSHOT", { x: MARGIN, y, size: 17, font: boldFont, color: DEEP_BLUE });
  y -= 10;
  page.drawRectangle({ x: MARGIN, y: y - 3, width: CONTENT_WIDTH, height: 3, color: BRIGHT_YELLOW });
  y -= 14;

  page.drawText(titleCaseAddress(property.address), { x: MARGIN, y, size: 11.5, font: boldFont, color: rgb(0x1c / 255, 0x64 / 255, 0x8b / 255) });
  y -= 12;
  page.drawText(`Preliminary insurance review for a new MLS listing  |  Prepared ${formatDateOnly(todayEt())}`, {
    x: MARGIN,
    y,
    size: 8.5,
    font,
    color: PERIWINKLE_GREY,
  });
  y -= 12;

  if (referralPartner) {
    const referralLine = [
      `Referred by ${referralPartner.name}`,
      referralPartner.companyName,
      referralPartner.phone,
      referralPartner.email,
    ]
      .filter(Boolean)
      .join("  ·  ");
    page.drawText(referralLine, { x: MARGIN, y, size: 8.5, font: boldFont, color: DEEP_BLUE });
    y -= 12;
  }
  y -= 2;

  // --- Photo box (left) + starting-indication box (right) ---
  const photoWidth = 300;
  const boxGap = 18;
  const indicationWidth = CONTENT_WIDTH - photoWidth - boxGap;
  const rowHeight = 130;
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
    page.drawRectangle({
      x: MARGIN,
      y: rowTop - rowHeight,
      width: photoWidth,
      height: rowHeight,
      color: WHITE,
      borderColor: PERIWINKLE_GREY,
      borderWidth: 0.75,
    });
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
  page.drawRectangle({
    x: indicationX,
    y: rowTop - rowHeight,
    width: indicationWidth,
    height: rowHeight,
    color: DEEP_BLUE,
    borderColor: PERIWINKLE_GREY,
    borderWidth: 0.75,
  });
  let boxY = rowTop - 18;
  const boxPad = 14;
  page.drawText(
    bestQuote ? `PRELIMINARY ${bestQuote.form_type ?? "HO3"}` : "PRELIMINARY",
    { x: indicationX + boxPad, y: boxY, size: 9, font: boldFont, color: BRIGHT_YELLOW }
  );
  boxY -= 10;
  page.drawText("STARTING INDICATION", { x: indicationX + boxPad, y: boxY, size: 9, font: boldFont, color: WHITE });
  boxY -= 30;
  page.drawText(bestQuote ? formatCurrency(Number(bestQuote.premium)) : "—", {
    x: indicationX + boxPad,
    y: boxY,
    size: 26,
    font: boldFont,
    color: WHITE,
  });
  boxY -= 13;
  page.drawText("estimated annual premium", { x: indicationX + boxPad, y: boxY, size: 8, font, color: rgb(0.85, 0.88, 0.92) });
  boxY -= 11;
  page.drawRectangle({ x: indicationX + boxPad, y: boxY, width: indicationWidth - boxPad * 2, height: 0.75, color: PERIWINKLE_GREY });
  boxY -= 15;
  page.drawText("Markets found:", { x: indicationX + boxPad, y: boxY, size: 9, font, color: WHITE });
  page.drawText(quotes?.length ? "YES" : "NO", {
    x: indicationX + boxPad + font.widthOfTextAtSize("Markets found: ", 9),
    y: boxY,
    size: 9,
    font: boldFont,
    color: BRIGHT_YELLOW,
  });
  boxY -= 12;
  page.drawText("Subject to application and underwriting", { x: indicationX + boxPad, y: boxY, size: 7.5, font, color: rgb(0.75, 0.79, 0.85) });
  const coverages = resolveCoverages((quotes ?? []).map((q) => q.coverages), property.sqft);
  if (coverages) {
    boxY -= 11;
    const basis = `Based on ${formatCurrency(coverages.dwelling_a)} dwelling${coverages.isDefault ? " (est.)" : ""}, ${coverages.personal_property_pct}% contents`;
    page.drawText(basis, { x: indicationX + boxPad, y: boxY, size: 7.5, font, color: rgb(0.75, 0.79, 0.85) });
  }

  y = rowTop - rowHeight - 10;

  function drawSectionHeader(label: string) {
    page.drawText(label, { x: MARGIN, y, size: 10.5, font: boldFont, color: DEEP_BLUE });
    y -= 12;
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
  const glanceHeight = 32;
  glanceItems.forEach((item, i) => {
    const x = MARGIN + i * (glanceWidth + glanceGap);
    page.drawRectangle({ x, y: y - glanceHeight, width: glanceWidth, height: glanceHeight, color: LIGHT_GREY, borderColor: PERIWINKLE_GREY, borderWidth: 0.75 });
    page.drawText(item.label, { x: x + 10, y: y - 13, size: 7, font: boldFont, color: PERIWINKLE_GREY });
    page.drawText(item.value, { x: x + 10, y: y - 25, size: 9.5, font: boldFont, color: DEEP_BLUE });
  });
  y -= glanceHeight + 10;

  // --- Preliminary carrier indications: a fixed 5-row table of the most
  // competitive options on file (cheapest first, any form), so it reads the
  // same regardless of how many carriers actually priced it. The 5th row is
  // always the customizable one — a producer's own manual entry
  // (properties.manual_carrier_name/manual_carrier_premium) for a company
  // that didn't pull a result through Fetch, blank until they fill it in.
  drawSectionHeader("PRELIMINARY CARRIER INDICATIONS");
  const sortedQuotes = [...((quotes ?? []) as QuoteRow[])].sort((a, b) => Number(a.premium) - Number(b.premium));
  const topQuotes = sortedQuotes.slice(0, 4);

  interface CarrierTableRow {
    carrier: string;
    form: string | null;
    premium: number | null;
    isManual: boolean;
    isBlank: boolean;
  }
  const tableRows: CarrierTableRow[] = [];
  for (let i = 0; i < 4; i++) {
    const q = topQuotes[i];
    tableRows.push(q ? { carrier: q.carrier, form: q.form_type, premium: Number(q.premium), isManual: false, isBlank: false } : { carrier: "", form: null, premium: null, isManual: false, isBlank: true });
  }
  tableRows.push(
    property.manual_carrier_name
      ? { carrier: property.manual_carrier_name, form: null, premium: property.manual_carrier_premium != null ? Number(property.manual_carrier_premium) : null, isManual: true, isBlank: false }
      : { carrier: "", form: null, premium: null, isManual: true, isBlank: true }
  );

  const colCarrier = MARGIN + 10;
  const colForm = MARGIN + 320;
  const colPremium = MARGIN + 420;
  const tableRowHeight = 16;
  const logoMaxWidth = 65;
  const logoMaxHeight = 12;

  const carrierLogos = new Map<string, PDFImage>();
  for (const carrier of new Set(tableRows.filter((r) => !r.isBlank).map((r) => r.carrier))) {
    const filename = CARRIER_LOGO_FILES[carrier];
    if (!filename) continue;
    const logoPath = join(CARRIER_LOGOS_DIR, filename);
    if (!existsSync(logoPath)) continue;
    carrierLogos.set(carrier, await pdfDoc.embedPng(readFileSync(logoPath)));
  }

  page.drawRectangle({
    x: MARGIN,
    y: y - tableRowHeight,
    width: CONTENT_WIDTH,
    height: tableRowHeight,
    color: DEEP_BLUE,
    borderColor: PERIWINKLE_GREY,
    borderWidth: 0.75,
  });
  page.drawText("CARRIER", { x: colCarrier, y: y - 12, size: 9, font: boldFont, color: WHITE });
  page.drawText("FORM", { x: colForm, y: y - 12, size: 9, font: boldFont, color: WHITE });
  page.drawText("ANNUAL", { x: colPremium, y: y - 12, size: 9, font: boldFont, color: WHITE });
  y -= tableRowHeight;

  tableRows.forEach((row, i) => {
    const rowTop2 = y;
    if (i === 0 && !row.isBlank) {
      page.drawRectangle({ x: MARGIN, y: rowTop2 - tableRowHeight, width: CONTENT_WIDTH, height: tableRowHeight, color: CREAM });
      page.drawRectangle({ x: MARGIN, y: rowTop2 - tableRowHeight, width: 3, height: tableRowHeight, color: BRIGHT_YELLOW });
    }
    page.drawRectangle({
      x: MARGIN,
      y: rowTop2 - tableRowHeight,
      width: CONTENT_WIDTH,
      height: tableRowHeight,
      borderColor: PERIWINKLE_GREY,
      borderWidth: 0.5,
      borderDashArray: row.isBlank ? [3, 3] : undefined,
    });
    const textY = rowTop2 - 12;
    const carrierFont = i === 0 && !row.isBlank ? boldFont : font;

    if (row.isBlank) {
      page.drawText(row.isManual ? "— add a company by hand —" : "—", { x: colCarrier, y: textY, size: 9, font: italicFont, color: PERIWINKLE_GREY });
    } else {
      let carrierTextX = colCarrier;
      const logo = carrierLogos.get(row.carrier);
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
      page.drawText(row.carrier, { x: carrierTextX, y: textY, size: 9.5, font: carrierFont, color: BLACK });
      page.drawText(row.form ?? "-", { x: colForm, y: textY, size: 9.5, font: carrierFont, color: BLACK });
      page.drawText(row.premium != null ? formatCurrency(row.premium) : "-", { x: colPremium, y: textY, size: 9.5, font: carrierFont, color: DEEP_BLUE });
    }
    y -= tableRowHeight;
  });

  // --- Bottom section, 3 columns: a reserved photo area (blank until an
  // agent headshot is uploaded on the Team page), the agent's info stacked
  // vertically, and "Have an interested buyer?" — resolved by
  // lib/quote-requests/proposal-agent.ts. Anchored just above the footer
  // rather than following straight on from the carrier table, so it sits
  // at the bottom of the page instead of trailing whatever whitespace is
  // left above it.
  const footerY = MARGIN + 24;
  const bottomBoxHeight = AGENT_SECTION_HEIGHT;
  const photoSize = 54;
  const photoX = MARGIN + 10;
  const col2X = photoX + photoSize + 12;
  const col2Width = 150;
  const divider2X = col2X + col2Width + 10;
  const col3X = divider2X + 14;
  const boxTop = footerY + 14 + bottomBoxHeight;
  page.drawRectangle({
    x: MARGIN,
    y: boxTop - bottomBoxHeight,
    width: CONTENT_WIDTH,
    height: bottomBoxHeight,
    color: CREAM,
    borderColor: BRIGHT_YELLOW,
    borderWidth: 1.5,
  });
  const dividerY = boxTop - bottomBoxHeight + 10;
  const dividerHeight = bottomBoxHeight - 20;
  page.drawRectangle({ x: divider2X, y: dividerY, width: 0.75, height: dividerHeight, color: PERIWINKLE_GREY });

  // Column 1: agent photo — a reserved, bordered area whether or not one's
  // been uploaded yet, so the layout doesn't shift once it is.
  const photoY = boxTop - bottomBoxHeight + (bottomBoxHeight - photoSize) / 2;
  page.drawRectangle({ x: photoX, y: photoY, width: photoSize, height: photoSize, color: WHITE, borderColor: PERIWINKLE_GREY, borderWidth: 0.75 });
  if (agent?.photoPath) {
    const { data: photoBlob } = await supabase.storage.from("agent-photos").download(agent.photoPath);
    if (photoBlob) {
      const photoBytes = new Uint8Array(await photoBlob.arrayBuffer());
      const photoImage = sniffImageKind(photoBytes) === "png" ? await pdfDoc.embedPng(photoBytes) : await pdfDoc.embedJpg(photoBytes);
      page.drawImage(photoImage, { x: photoX, y: photoY, width: photoSize, height: photoSize });
    }
  }

  // Column 2: your agent, one line each.
  if (agent) {
    let agentTextY = boxTop - 18;
    page.drawText("YOUR AGENT", { x: col2X, y: agentTextY, size: 8.5, font: boldFont, color: PERIWINKLE_GREY });
    agentTextY -= 16;
    page.drawText(agent.name, { x: col2X, y: agentTextY, size: 12, font: boldFont, color: DEEP_BLUE });
    agentTextY -= 15;
    page.drawText(AGENT_PHONE, { x: col2X, y: agentTextY, size: 9.5, font, color: BLACK });
    agentTextY -= 14;
    page.drawText(agent.email, { x: col2X, y: agentTextY, size: 9.5, font, color: BLACK });
  }

  // Column 3: "Have an interested buyer?" callout.
  let col3TextY = boxTop - 17;
  page.drawText("HAVE AN INTERESTED BUYER?", { x: col3X, y: col3TextY, size: 9.5, font: boldFont, color: DEEP_BLUE });
  col3TextY -= 13;
  page.drawText("Email us the buyer's name, phone number and email", { x: col3X, y: col3TextY, size: 8.5, font, color: rgb(0.3, 0.35, 0.4) });
  col3TextY -= 11;
  page.drawText("for a personalized quote.", { x: col3X, y: col3TextY, size: 8.5, font, color: rgb(0.3, 0.35, 0.4) });

  // --- Footer ---
  page.drawRectangle({ x: MARGIN, y: footerY, width: CONTENT_WIDTH, height: 0.75, color: PERIWINKLE_GREY });
  page.drawText(
    "Indicative estimates only, based on a placeholder applicant profile. Final premiums require a full application and",
    { x: MARGIN, y: footerY - 13, size: 7.5, font, color: PERIWINKLE_GREY }
  );
  page.drawText("are subject to underwriting, inspections, property documentation, coverage selections and applicant details.", {
    x: MARGIN,
    y: footerY - 23,
    size: 7.5,
    font,
    color: PERIWINKLE_GREY,
  });
  const tagline = "The brighter way to do insurance.";
  const taglineWidth = italicFont.widthOfTextAtSize(tagline, 9);
  page.drawText(tagline, { x: PAGE_WIDTH - MARGIN - taglineWidth, y: footerY - 33, size: 9, font: italicFont, color: DEEP_BLUE });

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
