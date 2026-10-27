import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PDFDocument, StandardFonts, rgb, type PDFImage } from "pdf-lib";
import { createServiceSupabase } from "@/lib/supabase/server";
import { coverageLines, resolveCoverages } from "@/lib/quotes/coverage";
import type { ReferralPartnerInfo } from "@/lib/quote-requests/referral-partner";
import { resolveProposalAgent } from "@/lib/quote-requests/proposal-agent";
import { todayEt, formatDateOnly } from "@/lib/dates";
import { titleCaseAddress } from "@/lib/address/title-case";

function sniffImageKind(bytes: Uint8Array): "jpg" | "png" {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  return "jpg";
}

const AGENT_SECTION_HEIGHT = 74;
// The agency's one office line with its one shared extension — every agent's
// calls route through this same number/extension, not a per-agent one.
const AGENCY_PHONE = "727-789-2200 X.1";
// Every in-house agent's "company" for the co-branded section's matching
// name/company/phone/email shape — there's one agency, not a per-agent one.
const AGENCY_NAME = "Brightway Insurance | The Harrington Agency";

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

/**
 * Builds a one-page indication summary PDF from a property's existing
 * quotes and enrichment data, uploads it to the `proposals` bucket, and
 * records a `proposals` row. Purely reads our own Supabase data — no
 * external network calls.
 *
 * `referralPartner`, when given, credits the realtor/mortgage broker who
 * requested this quote on the buyer's behalf (see
 * lib/quote-requests/referral-partner.ts) with a line near the top of the
 * document. Omit it (the default for every manually-run quote) and the
 * layout is exactly what it always was — this never shifts anything else.
 *
 * `roofScenario`, when true, renders this as the "New Roof Scenario -
 * Insurance Summary" variant instead: same layout and data, but retitled
 * and with a note that the premiums assume a newly installed roof — because
 * they do. finalizeQuoteRequest (lib/quote-requests/fetch-pipeline.ts) sets
 * this for roofing_company referral partners, whose Fetch quote items
 * already ran under that same assumption (buildQuoteFields's
 * roofingCompanyOverride forces roof_year to the current calendar year —
 * see lib/adapters/fetch-quoting.ts). Saved with proposals.kind =
 * "roof_scenario" and path prefix "roof-scenario-" instead of "indication".
 */
export async function generateIndicationProposal(
  propertyId: string,
  referralPartner?: ReferralPartnerInfo | null,
  quoteRequestId?: string | null,
  roofScenario = false
): Promise<GenerateIndicationResult> {
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
  let page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const italicFont = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

  const headerLogoBytes = readFileSync(join(BRANDING_DIR, "brightway-harrington-horizontal-deep-blue.png"));
  const headerLogo = await pdfDoc.embedPng(headerLogoBytes);
  const footerMarkBytes = readFileSync(join(BRANDING_DIR, "brightway-mark-deep-blue.png"));
  const footerMark = await pdfDoc.embedPng(footerMarkBytes);

  let y = PAGE_HEIGHT - MARGIN;

  // --- Header: Brightway | The Harrington Agency lockup, title, then the
  // yellow accent rule below the title (not between the logo and title). ---
  // 4x the original 200pt width would be 800pt, wider than the page itself
  // (504pt of content width between margins) — capped to the widest size
  // that still fits cleanly on the page.
  const logoWidth = Math.min(200 * 4, PAGE_WIDTH - 2 * MARGIN - 24);
  const logoHeight = logoWidth * (headerLogo.height / headerLogo.width);
  page.drawImage(headerLogo, { x: MARGIN, y: y - logoHeight, width: logoWidth, height: logoHeight });
  y -= logoHeight + 18;

  const title = roofScenario ? "New Roof Scenario - Insurance Summary" : "Insurance Indication Summary";
  page.drawText(title, { x: MARGIN, y, size: 19, font: boldFont, color: DEEP_BLUE });
  y -= 12;
  page.drawRectangle({ x: MARGIN, y: y - 3, width: PAGE_WIDTH - 2 * MARGIN, height: 3, color: BRIGHT_YELLOW });
  y -= 19;

  page.drawText(titleCaseAddress(property.address), { x: MARGIN, y, size: 12, font, color: DEEP_BLUE });
  y -= 15;
  page.drawText(`Prepared by The Harrington Agency  ·  ${formatDateOnly(todayEt())}`, {
    x: MARGIN,
    y,
    size: 9,
    font,
    color: PERIWINKLE_GREY,
  });
  y -= 15;

  if (roofScenario) {
    page.drawText(
      `Premiums below assume a newly installed roof (${todayEt().slice(0, 4)}), not the home's current roof.`,
      { x: MARGIN, y, size: 9, font: italicFont, color: DEEP_BLUE }
    );
    y -= 15;
  }

  if (referralPartner) {
    const referralLine = [
      `Referred by ${referralPartner.name}`,
      referralPartner.companyName,
      referralPartner.phone,
      referralPartner.email,
    ]
      .filter(Boolean)
      .join("  ·  ");
    page.drawText(referralLine, { x: MARGIN, y, size: 9, font: boldFont, color: DEEP_BLUE });
    y -= 15;
  }
  y -= 13;

  function drawSectionHeader(label: string) {
    page.drawRectangle({ x: MARGIN, y: y - 8, width: 8, height: 8, color: BRIGHT_YELLOW });
    page.drawText(label, { x: MARGIN + 14, y: y - 7.5, size: 11, font: boldFont, color: DEEP_BLUE });
    y -= 22;
  }

  // --- Property Snapshot: cream color-blocked panel per brand color usage guide ---
  drawSectionHeader("PROPERTY SNAPSHOT");
  const coverages = resolveCoverages(quotes.map((q) => q.coverages), property.sqft);
  const snapshot = [
    property.year_built ? `Year Built: ${property.year_built}` : null,
    property.sqft ? `Living Area: ${property.sqft.toLocaleString()} sqft` : null,
    property.construction ? `Construction: ${property.construction}` : null,
    property.beds != null && property.baths != null ? `${property.beds} bd / ${property.baths} ba` : null,
    enrichment?.flood_zone ? `Flood Zone: ${enrichment.flood_zone}` : null,
    ...(coverages ? coverageLines(coverages) : []),
  ].filter((line): line is string => line != null);

  const panelPadding = 12;
  const panelHeight = snapshot.length * 14 + panelPadding * 2 - 4;
  page.drawRectangle({
    x: MARGIN,
    y: y - panelHeight,
    width: PAGE_WIDTH - 2 * MARGIN,
    height: panelHeight,
    color: CREAM,
    borderColor: PERIWINKLE_GREY,
    borderWidth: 0.75,
  });
  let snapshotY = y - panelPadding - 8;
  for (const line of snapshot) {
    page.drawText(line, { x: MARGIN + panelPadding, y: snapshotY, size: 10, font, color: BLACK });
    snapshotY -= 14;
  }
  y -= panelHeight + 24;

  // --- Carrier Indications table (paginated: DP3 rows follow the HO3 rows and
  // spill onto continuation pages, each with its own header and footer) ---
  drawSectionHeader("CARRIER INDICATIONS");
  const colCarrier = MARGIN + 10;
  const colForm = MARGIN + 262;
  const colPremium = MARGIN + 400;
  const rowHeight = 20; // tightened from 22 to leave room for the coverage lines above the table
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
  // Highlight the cheapest HO3, not the cheapest overall — DP3 is a rental
  // form and usually cheaper, so it shouldn't read as the top pick.
  const bestQuoteId = (displayQuotes.find((q) => q.form_type === "HO3") ?? displayQuotes[0])!.id;

  const propertyAddress = titleCaseAddress(property.address);
  const formLabel = (form: string | null) => (form === "DP3" ? "DP3 (rental property)" : (form ?? "-"));

  function drawTableHeader() {
    page.drawRectangle({
      x: MARGIN,
      y: y - rowHeight,
      width: tableWidth,
      height: rowHeight,
      color: DEEP_BLUE,
      borderColor: PERIWINKLE_GREY,
      borderWidth: 0.75,
    });
    page.drawText("Carrier", { x: colCarrier, y: y - 15, size: 10, font: boldFont, color: WHITE });
    page.drawText("Form", { x: colForm, y: y - 15, size: 10, font: boldFont, color: WHITE });
    page.drawText("Annual Premium", { x: colPremium, y: y - 15, size: 10, font: boldFont, color: WHITE });
    y -= rowHeight;
  }

  function drawFooter() {
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
  }

  async function embedPhoto(bucket: string, path: string): Promise<PDFImage | null> {
    const { data: blob } = await supabase.storage.from(bucket).download(path);
    if (!blob) return null;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return sniffImageKind(bytes) === "png" ? await pdfDoc.embedPng(bytes) : await pdfDoc.embedJpg(bytes);
  }

  // The co-branded section's columns are narrower than the agent-only
  // layout's ever were — a long referral-partner email (or just a longer
  // one than the agency's own short @brightway.com addresses) can run past
  // the column's edge at a fixed size. Same shrink-to-fit idea as the
  // aerial-photo caption in generate-listing-snapshot.ts, just reusable here.
  function fitSize(f: typeof font, text: string, maxWidth: number, size: number, minSize = 6): number {
    let s = size;
    while (f.widthOfTextAtSize(text, s) > maxWidth && s > minSize) s -= 0.5;
    return s;
  }

  // No referral partner (every manually-run or public-form quote): the
  // original 3-column layout, unchanged — a reserved photo area, the
  // agent's info stacked vertically, and "Have an interested buyer?".
  async function drawAgentOnlySection() {
    const contentWidth = PAGE_WIDTH - 2 * MARGIN;
    const boxHeight = AGENT_SECTION_HEIGHT;
    const photoSize = 50;
    const photoX = MARGIN + 12;
    const col2X = photoX + photoSize + 14;
    const col2Width = 160;
    const divider2X = col2X + col2Width + 10;
    const col3X = divider2X + 14;
    const boxTop = y;
    page.drawRectangle({
      x: MARGIN,
      y: boxTop - boxHeight,
      width: contentWidth,
      height: boxHeight,
      color: CREAM,
      borderColor: PERIWINKLE_GREY,
      borderWidth: 0.75,
    });
    const dividerY = boxTop - boxHeight + 12;
    const dividerHeight = boxHeight - 24;
    page.drawRectangle({ x: divider2X, y: dividerY, width: 0.75, height: dividerHeight, color: PERIWINKLE_GREY });

    // Column 1: agent photo — reserved and bordered whether or not one's
    // been uploaded yet, so the layout doesn't shift once it is.
    const photoY = boxTop - boxHeight + (boxHeight - photoSize) / 2;
    page.drawRectangle({ x: photoX, y: photoY, width: photoSize, height: photoSize, color: WHITE, borderColor: PERIWINKLE_GREY, borderWidth: 0.75 });
    if (agent?.photoPath) {
      const photoImage = await embedPhoto("agent-photos", agent.photoPath);
      if (photoImage) page.drawImage(photoImage, { x: photoX, y: photoY, width: photoSize, height: photoSize });
    }

    // Column 2: your agent, one line each.
    if (agent) {
      let textY = boxTop - 18;
      page.drawText("YOUR AGENT", { x: col2X, y: textY, size: 8, font: boldFont, color: PERIWINKLE_GREY });
      textY -= 15;
      page.drawText(agent.name, { x: col2X, y: textY, size: 11, font: boldFont, color: DEEP_BLUE });
      textY -= 14;
      page.drawText(AGENCY_PHONE, { x: col2X, y: textY, size: 9, font, color: BLACK });
      textY -= 13;
      page.drawText(agent.email, { x: col2X, y: textY, size: 9, font, color: BLACK });
    }

    // Column 3: "Have an interested buyer?" callout.
    let col3Y = boxTop - 18;
    page.drawText("HAVE AN INTERESTED BUYER?", { x: col3X, y: col3Y, size: 9, font: boldFont, color: DEEP_BLUE });
    col3Y -= 13;
    page.drawText("Email us the buyer's name, phone number", { x: col3X, y: col3Y, size: 8, font, color: PERIWINKLE_GREY });
    col3Y -= 11;
    page.drawText("and email for a personalized quote.", { x: col3X, y: col3Y, size: 8, font, color: PERIWINKLE_GREY });

    y -= boxHeight + 14;
  }

  // A referral partner credited this proposal: split the box in half
  // instead — Brightway agent (left) and the co-branded referral partner's
  // own name/phone/email/photo (right), same shape mirrored. Drops the
  // "interested buyer?" callout (no room once halved) and moves the
  // yellow accent below the box instead of bordering it, matching the
  // listing-snapshot sibling document's equivalent change.
  async function drawCoBrandedSection(partner: ReferralPartnerInfo) {
    const contentWidth = PAGE_WIDTH - 2 * MARGIN;
    const boxHeight = AGENT_SECTION_HEIGHT;
    const halfWidth = contentWidth / 2;
    const photoSize = 44;
    const leftPhotoX = MARGIN + 10;
    const leftTextX = leftPhotoX + photoSize + 12;
    const dividerX = MARGIN + halfWidth;
    const rightPhotoX = dividerX + 14;
    const rightTextX = rightPhotoX + photoSize + 12;
    const boxTop = y;

    page.drawRectangle({
      x: MARGIN,
      y: boxTop - boxHeight,
      width: contentWidth,
      height: boxHeight,
      color: CREAM,
      borderColor: PERIWINKLE_GREY,
      borderWidth: 0.75,
    });
    const dividerY = boxTop - boxHeight + 12;
    const dividerHeight = boxHeight - 24;
    page.drawRectangle({ x: dividerX, y: dividerY, width: 0.75, height: dividerHeight, color: PERIWINKLE_GREY });

    const photoY = boxTop - boxHeight + (boxHeight - photoSize) / 2;

    // Left: Brightway agent.
    page.drawRectangle({ x: leftPhotoX, y: photoY, width: photoSize, height: photoSize, color: WHITE, borderColor: PERIWINKLE_GREY, borderWidth: 0.75 });
    if (agent?.photoPath) {
      const photoImage = await embedPhoto("agent-photos", agent.photoPath);
      if (photoImage) page.drawImage(photoImage, { x: leftPhotoX, y: photoY, width: photoSize, height: photoSize });
    }
    const leftMaxWidth = dividerX - leftTextX - 6;
    if (agent) {
      let textY = boxTop - 20;
      page.drawText(agent.name, { x: leftTextX, y: textY, size: fitSize(boldFont, agent.name, leftMaxWidth, 11), font: boldFont, color: DEEP_BLUE });
      textY -= 14;
      page.drawText(AGENCY_NAME, { x: leftTextX, y: textY, size: fitSize(font, AGENCY_NAME, leftMaxWidth, 9), font, color: BLACK });
      textY -= 13;
      page.drawText(AGENCY_PHONE, { x: leftTextX, y: textY, size: 9, font, color: BLACK });
      textY -= 13;
      page.drawText(agent.email, { x: leftTextX, y: textY, size: fitSize(font, agent.email, leftMaxWidth, 9), font, color: BLACK });
    }

    // Right: co-branded referral partner.
    page.drawRectangle({ x: rightPhotoX, y: photoY, width: photoSize, height: photoSize, color: WHITE, borderColor: PERIWINKLE_GREY, borderWidth: 0.75 });
    if (partner.photoPath) {
      const photoImage = await embedPhoto("partner-photos", partner.photoPath);
      if (photoImage) page.drawImage(photoImage, { x: rightPhotoX, y: photoY, width: photoSize, height: photoSize });
    }
    const rightMaxWidth = MARGIN + contentWidth - rightTextX - 6;
    let rightTextY = boxTop - 20;
    page.drawText(partner.name, { x: rightTextX, y: rightTextY, size: fitSize(boldFont, partner.name, rightMaxWidth, 11), font: boldFont, color: DEEP_BLUE });
    rightTextY -= 14;
    if (partner.companyName) {
      page.drawText(partner.companyName, { x: rightTextX, y: rightTextY, size: fitSize(font, partner.companyName, rightMaxWidth, 9), font, color: BLACK });
      rightTextY -= 13;
    }
    if (partner.phone) {
      page.drawText(partner.phone, { x: rightTextX, y: rightTextY, size: 9, font, color: BLACK });
      rightTextY -= 13;
    }
    page.drawText(partner.email, { x: rightTextX, y: rightTextY, size: fitSize(font, partner.email, rightMaxWidth, 9), font, color: BLACK });

    const yellowY = boxTop - boxHeight - 3;
    page.drawRectangle({ x: MARGIN, y: yellowY, width: contentWidth, height: 3, color: BRIGHT_YELLOW });
    y = yellowY - 14;
  }

  async function drawAgentSection() {
    if (referralPartner) await drawCoBrandedSection(referralPartner);
    else await drawAgentOnlySection();
  }

  function startContinuationPage() {
    drawFooter();
    page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    y = PAGE_HEIGHT - MARGIN;
    page.drawText(`${title} (continued)`, { x: MARGIN, y: y - 12, size: 14, font: boldFont, color: DEEP_BLUE });
    page.drawText(propertyAddress, { x: MARGIN, y: y - 28, size: 10, font, color: PERIWINKLE_GREY });
    page.drawRectangle({ x: MARGIN, y: y - 38, width: PAGE_WIDTH - 2 * MARGIN, height: 3, color: BRIGHT_YELLOW });
    y -= 52;
    drawTableHeader();
  }

  drawTableHeader();
  displayQuotes.forEach((quote, i) => {
    if (y < MARGIN + FOOTER_RESERVE) startContinuationPage();
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
    page.drawRectangle({ x: MARGIN, y: rowTop - rowHeight, width: tableWidth, height: rowHeight, borderColor: PERIWINKLE_GREY, borderWidth: 0.5 });
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
    page.drawText(formLabel(quote.form_type), { x: colForm, y: textY, size: 10, font: carrierFont, color: BLACK });
    page.drawText(formatCurrency(Number(quote.premium)), { x: colPremium, y: textY, size: 10, font: carrierFont, color: DEEP_BLUE });
    y -= rowHeight;
  });

  if (y - AGENT_SECTION_HEIGHT < MARGIN + FOOTER_RESERVE) startContinuationPage();
  await drawAgentSection();
  drawFooter();

  const pdfBytes = await pdfDoc.save();
  const kind = roofScenario ? "roof_scenario" : "indication";
  const path = `${property.agency_id}/${propertyId}/${roofScenario ? "roof-scenario" : "indication"}-v${version}.pdf`;

  const { error: uploadError } = await supabase.storage
    .from("proposals")
    .upload(path, pdfBytes, { contentType: "application/pdf", upsert: true });
  if (uploadError) throw new Error(`Failed to upload proposal PDF: ${uploadError.message}`);

  const { data: proposal, error: insertError } = await supabase
    .from("proposals")
    .insert({ agency_id: property.agency_id, property_id: propertyId, kind, pdf_path: path, version })
    .select("id")
    .single();
  if (insertError || !proposal) {
    throw new Error(`Failed to record proposal row: ${insertError?.message ?? "no row returned"}`);
  }

  return { proposalId: proposal.id, path, version };
}
