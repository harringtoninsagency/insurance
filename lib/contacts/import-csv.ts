import type { SupabaseClient } from "@supabase/supabase-js";
import type { ContactSource, ContactType, Database } from "@/lib/types/database";
import { upsertContact, type ContactInput } from "@/lib/contacts/upsert-contact";

/** Minimal RFC-4180 parser: quoted fields, escaped quotes, embedded commas/newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");

  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f.trim())) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  row.push(field);
  if (row.some((f) => f.trim())) rows.push(row);
  return rows;
}

// Header names seen in brokerage rosters, MLS/association exports, NMLS pulls
// and CRM exports, all mapped onto our fields. Matching ignores case and
// punctuation ("Cell Phone", "cell_phone" and "CELL" all resolve).
const ALIASES: Record<string, string[]> = {
  fullName: ["name", "full name", "fullname", "contact", "contact name", "agent", "agent name", "licensee name", "loan officer", "mlo", "mlo name"],
  firstName: ["first name", "firstname", "first"],
  lastName: ["last name", "lastname", "last", "surname"],
  companyName: ["company", "company name", "brokerage", "brokerage name", "office", "office name", "employer", "firm", "lender", "dba"],
  cellPhone: ["cell", "cell phone", "cellphone", "mobile", "mobile phone", "direct", "direct phone"],
  officePhone: ["office phone", "work phone", "business phone", "phone", "office", "telephone", "main phone"],
  email: ["email", "email address", "e-mail", "e mail"],
  licenseNumber: ["license", "license number", "license #", "license no", "lic", "nmls", "nmls id", "nmls #"],
  city: ["city", "office city"],
  type: ["type", "contact type", "role"],
};

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9# ]/g, " ").replace(/\s+/g, " ").trim();

function mapHeaders(header: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  const normalized = header.map(norm);
  // Exact-alias order matters: "office" is a company alias, but a column named
  // "office phone" must go to officePhone, so more specific fields claim first.
  const order = ["cellPhone", "officePhone", "email", "licenseNumber", "fullName", "firstName", "lastName", "companyName", "city", "type"];
  const taken = new Set<number>();
  for (const field of order) {
    const idx = normalized.findIndex((h, i) => !taken.has(i) && ALIASES[field]!.includes(h));
    if (idx >= 0) {
      map[field] = idx;
      taken.add(idx);
    }
  }
  return map;
}

function parseType(raw: string | undefined, fallback: ContactType): ContactType {
  const v = raw?.toLowerCase() ?? "";
  if (/mortgage|lender|loan|mlo|broker.*mortgage|nmls/.test(v)) return "mortgage_broker";
  if (/real\s*estate|realtor|sales|agent|broker/.test(v)) return "realtor";
  return fallback;
}

export interface ImportSummary {
  rows: number;
  inserted: number;
  updated: number;
  unchanged: number;
  rejected: Array<{ row: number; reason: string }>;
  missingColumns: string[];
}

export async function importContactsCsv(
  supabase: SupabaseClient<Database>,
  agencyId: string,
  csvText: string,
  options: { defaultType: ContactType; source: ContactSource; sourceDetail: string | null; maxRows?: number }
): Promise<ImportSummary> {
  const summary: ImportSummary = { rows: 0, inserted: 0, updated: 0, unchanged: 0, rejected: [], missingColumns: [] };
  const [header, ...body] = parseCsv(csvText);
  if (!header) {
    summary.missingColumns.push("header row");
    return summary;
  }

  const col = mapHeaders(header);
  const hasName = col.fullName != null || (col.firstName != null && col.lastName != null);
  if (!hasName) summary.missingColumns.push("name (or first name + last name)");
  if (col.email == null && col.cellPhone == null && col.officePhone == null) {
    summary.missingColumns.push("at least one of email / cell phone / office phone");
  }
  if (summary.missingColumns.length) return summary;

  const cell = (fields: string[], key: string) => (col[key] != null ? fields[col[key]!] : undefined);

  for (const [i, fields] of body.slice(0, options.maxRows ?? body.length).entries()) {
    summary.rows += 1;
    const fullName =
      cell(fields, "fullName") ?? `${cell(fields, "firstName") ?? ""} ${cell(fields, "lastName") ?? ""}`;
    const input: ContactInput = {
      contactType: parseType(cell(fields, "type"), options.defaultType),
      fullName,
      companyName: cell(fields, "companyName"),
      cellPhone: cell(fields, "cellPhone"),
      officePhone: cell(fields, "officePhone"),
      email: cell(fields, "email"),
      licenseNumber: cell(fields, "licenseNumber"),
      city: cell(fields, "city"),
      source: options.source,
      sourceDetail: options.sourceDetail,
    };
    const outcome = await upsertContact(supabase, agencyId, input);
    if (outcome.result === "rejected") summary.rejected.push({ row: i + 2, reason: outcome.reason });
    else summary[outcome.result] += 1;
  }
  return summary;
}
