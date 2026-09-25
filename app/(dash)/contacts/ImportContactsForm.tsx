"use client";

import { useActionState } from "react";
import { importContactsAction, type ImportState } from "./actions";

const inputClass = "w-full rounded border border-slate-300 px-2 py-1.5 text-sm";

export function ImportContactsForm() {
  const [state, formAction, isPending] = useActionState<ImportState, FormData>(importContactsAction, null);

  return (
    <form action={formAction} className="space-y-4 text-sm">
      <p className="text-slate-500">
        Upload a CSV from a brokerage roster, association list, NMLS pull or your CRM. Columns are matched by name
        (name or first/last, company, cell, phone, email, license, city). Up to 1,000 rows and 2MB per upload; people
        already in the directory are matched and only have blanks filled in.
      </p>
      <div className="grid grid-cols-3 gap-4">
        <div className="space-y-1">
          <label htmlFor="import_contact_type" className="text-xs text-slate-500">
            Default type
          </label>
          <select id="import_contact_type" name="contact_type" className={inputClass}>
            <option value="realtor">Realtors</option>
            <option value="mortgage_broker">Mortgage brokers</option>
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor="import_source" className="text-xs text-slate-500">
            Source
          </label>
          <select id="import_source" name="source" className={inputClass} defaultValue="csv_import">
            <option value="csv_import">CSV / roster</option>
            <option value="public_license">Public license file</option>
            <option value="event">Event sign-in</option>
            <option value="referral">Referral list</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor="import_source_detail" className="text-xs text-slate-500">
            Source note (optional)
          </label>
          <input id="import_source_detail" name="source_detail" type="text" placeholder="e.g. Keller Williams roster" className={inputClass} />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <input name="file" type="file" accept=".csv,text/csv" className="text-sm" />
        <button
          type="submit"
          disabled={isPending}
          className="rounded border border-[#003049] px-3 py-1.5 text-sm font-medium text-[#003049] disabled:opacity-50"
        >
          {isPending ? "Importing..." : "Import"}
        </button>
      </div>
      {state && "error" in state && <p className="text-red-600">{state.error}</p>}
      {state && "summary" in state && (
        <div className="space-y-1 rounded bg-slate-50 px-3 py-2">
          {state.summary.missingColumns.length > 0 ? (
            <p className="text-red-600">Couldn&apos;t import {state.fileName}: no column found for {state.summary.missingColumns.join("; ")}.</p>
          ) : (
            <p className="text-slate-700">
              {state.fileName}: {state.summary.rows} rows — {state.summary.inserted} added, {state.summary.updated} enriched,{" "}
              {state.summary.unchanged} already complete, {state.summary.rejected.length} skipped.
            </p>
          )}
          {state.summary.rejected.slice(0, 8).map((r) => (
            <p key={r.row} className="text-xs text-slate-500">
              Row {r.row}: {r.reason}
            </p>
          ))}
        </div>
      )}
    </form>
  );
}
