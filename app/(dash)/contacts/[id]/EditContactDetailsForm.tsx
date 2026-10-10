"use client";

import { useState, useTransition } from "react";
import { updateContactDetailsAction, type ContactDetailsPayload } from "../actions";

const inputClass = "w-full rounded border border-slate-300 px-2 py-1.5 text-sm";

interface ContactDetails {
  id: string;
  fullName: string;
  companyName: string | null;
  cellPhone: string | null;
  officePhone: string | null;
  email: string | null;
  licenseNumber: string | null;
  city: string | null;
}

const FIELDS: Array<{ key: keyof ContactDetailsPayload; label: string; type: string }> = [
  { key: "fullName", label: "Full name", type: "text" },
  { key: "companyName", label: "Company / brokerage", type: "text" },
  { key: "cellPhone", label: "Cell", type: "tel" },
  { key: "officePhone", label: "Office", type: "tel" },
  { key: "email", label: "Email", type: "email" },
  { key: "licenseNumber", label: "License #", type: "text" },
  { key: "city", label: "City", type: "text" },
];

function toPayload(c: ContactDetails): ContactDetailsPayload {
  return {
    fullName: c.fullName,
    companyName: c.companyName ?? "",
    cellPhone: c.cellPhone ?? "",
    officePhone: c.officePhone ?? "",
    email: c.email ?? "",
    licenseNumber: c.licenseNumber ?? "",
    city: c.city ?? "",
  };
}

export function EditContactDetailsForm({ contact }: { contact: ContactDetails }) {
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<ContactDetailsPayload>(toPayload(contact));
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function startEditing() {
    setValues(toPayload(contact));
    setError(null);
    setEditing(true);
  }

  function cancel() {
    setValues(toPayload(contact));
    setError(null);
    setEditing(false);
  }

  function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await updateContactDetailsAction(contact.id, values);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setEditing(false);
    });
  }

  if (!editing) {
    const display: Array<[string, string | null]> = [
      ["Company", contact.companyName],
      ["Cell", contact.cellPhone],
      ["Office", contact.officePhone],
      ["Email", contact.email],
      ["License #", contact.licenseNumber],
      ["City", contact.city],
    ];
    return (
      <>
        {display.map(([label, value]) => (
          <div key={label}>
            <div className="text-xs text-slate-500">{label}</div>
            <div className="text-slate-800">{value ?? "—"}</div>
          </div>
        ))}
        <div className="flex items-end">
          <button
            type="button"
            onClick={startEditing}
            className="rounded border border-[#003049] px-3 py-1.5 text-sm font-medium text-[#003049] hover:bg-[#003049]/5"
          >
            Edit contact details
          </button>
        </div>
      </>
    );
  }

  return (
    <form onSubmit={save} className="col-span-1 grid grid-cols-1 gap-4 sm:col-span-3 sm:grid-cols-3">
      {FIELDS.map((f) => (
        <div key={f.key} className="space-y-1">
          <label htmlFor={`edit_${f.key}`} className="text-xs text-slate-500">
            {f.label}
          </label>
          <input
            id={`edit_${f.key}`}
            type={f.type}
            value={values[f.key]}
            onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
            className={inputClass}
          />
        </div>
      ))}
      <div className="col-span-1 flex items-center gap-3 sm:col-span-3">
        <button
          type="submit"
          disabled={isPending}
          className="rounded bg-[#003049] px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {isPending ? "Saving..." : "Save and update record"}
        </button>
        <button
          type="button"
          onClick={cancel}
          disabled={isPending}
          className="rounded border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 disabled:opacity-50"
        >
          Cancel
        </button>
        {error && <span className="text-sm text-red-600">{error}</span>}
      </div>
    </form>
  );
}
