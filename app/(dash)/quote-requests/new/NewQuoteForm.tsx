"use client";

import { useActionState, useState, useTransition } from "react";
import Link from "next/link";
import { runQuoteForAddressAction, verifyQuoteAddressAction, type NewQuoteState } from "../actions";
import type { VerifyAddressResult } from "@/lib/geocoding/verify-address";

const inputClass = "w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-[#003049] focus:outline-none";
const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

function Field({ id, label, ...props }: { id: string; label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-xs font-medium text-slate-600">
        {label}
      </label>
      <input id={id} name={id} className={inputClass} {...props} />
    </div>
  );
}

type Verification = { status: "idle" | "checking" } | ({ status: "verified"; key: string } & { result: Extract<VerifyAddressResult, { ok: true }> }) | { status: "failed"; error: string };

export function NewQuoteForm() {
  const [state, formAction, isPending] = useActionState<NewQuoteState, FormData>(runQuoteForAddressAction, null);
  const [isVerifying, startVerifying] = useTransition();
  const [verification, setVerification] = useState<Verification>({ status: "idle" });

  const [addressLine, setAddressLine] = useState("");
  const [city, setCity] = useState("");
  const [addrState, setAddrState] = useState("FL");
  const [zipcode, setZipcode] = useState("");
  const addressKey = `${addressLine}|${city}|${addrState}|${zipcode}`;

  // Editing any address field after verifying invalidates it — the pin and
  // "run quote now" gate should always match what's actually in the fields.
  function updateAddress(setter: (v: string) => void) {
    return (v: string) => {
      setter(v);
      if (verification.status !== "idle" && verification.status !== "checking") setVerification({ status: "idle" });
    };
  }

  function verify() {
    startVerifying(async () => {
      setVerification({ status: "checking" });
      const result = await verifyQuoteAddressAction(addressLine, city, addrState, zipcode);
      setVerification(result.ok ? { status: "verified", key: addressKey, result } : { status: "failed", error: result.error });
    });
  }

  if (state && "queued" in state) {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 px-5 py-5 text-sm text-green-900">
        <p className="font-semibold">{state.queued.alreadyQueued ? "That property already has a quote queued." : "Quote queued."}</p>
        <p className="mt-1">
          {state.queued.started
            ? "It's matched to county records and the quote run has started — results usually show up on the property page within a few minutes."
            : "It's matched to county records and will be quoted on the next run. Results show up on the property page."}
        </p>
        <div className="mt-3 flex gap-4">
          <Link href={`/properties/${state.queued.propertyId}`} className="font-medium text-[#003049] underline">
            Open the property
          </Link>
          <Link href="/quote-requests/new" className="font-medium text-[#003049] underline">
            Run another
          </Link>
        </div>
      </div>
    );
  }

  const isVerified = verification.status === "verified" && verification.key === addressKey;

  return (
    <form action={formAction} className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field
            id="address_line"
            label="Street address *"
            type="text"
            required
            placeholder="2465 Indian Trail West"
            value={addressLine}
            onChange={(e) => updateAddress(setAddressLine)(e.target.value)}
          />
        </div>
        <Field id="city" label="City *" type="text" required value={city} onChange={(e) => updateAddress(setCity)(e.target.value)} />
        <div className="grid grid-cols-2 gap-4">
          <Field id="state" label="State" type="text" value={addrState} onChange={(e) => updateAddress(setAddrState)(e.target.value)} />
          <Field id="zipcode" label="Zip" type="text" value={zipcode} onChange={(e) => updateAddress(setZipcode)(e.target.value)} />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <label htmlFor="request_kind" className="text-xs font-medium text-slate-600">
            What to produce
          </label>
          <select id="request_kind" name="request_kind" defaultValue="both" className={inputClass}>
            <option value="both">Quote summary + listing snapshot</option>
            <option value="quote_summary">Quote summary only</option>
            <option value="listing_snapshot">Listing snapshot only</option>
          </select>
        </div>
      </div>

      <div className="space-y-2 rounded border border-slate-200 p-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-slate-500">Verify this address with Google Maps before running a quote — catches a typo'd street, city or zip.</p>
          <button
            type="button"
            onClick={verify}
            disabled={isVerifying || !addressLine.trim() || !city.trim()}
            className="shrink-0 rounded border border-[#003049] px-3 py-1.5 text-xs font-semibold text-[#003049] disabled:opacity-50"
          >
            {isVerifying ? "Verifying..." : "Verify address"}
          </button>
        </div>

        {verification.status === "failed" && <p className="text-sm text-red-600">{verification.error}</p>}

        {isVerified && (
          <div className="space-y-2">
            <p className="text-sm text-green-700">✓ Verified: {verification.result.address.formattedAddress}</p>
            {GOOGLE_MAPS_API_KEY && (
              <iframe
                title="Address location"
                className="h-48 w-full rounded border border-slate-200"
                loading="lazy"
                src={`https://www.google.com/maps/embed/v1/place?key=${GOOGLE_MAPS_API_KEY}&q=${verification.result.address.lat},${verification.result.address.lng}&zoom=17`}
              />
            )}
          </div>
        )}
      </div>

      <details className="rounded border border-slate-200 p-3 text-sm">
        <summary className="cursor-pointer font-medium text-slate-700">Know more about the property? (optional — county records fill these in when found)</summary>
        <div className="mt-3 grid gap-4 sm:grid-cols-3">
          <Field id="year_built" label="Year built" type="number" />
          <Field id="sqft" label="Square footage" type="number" />
          <Field id="construction" label="Construction (frame/masonry)" type="text" />
          <Field id="beds" label="Bedrooms" type="number" />
          <Field id="baths" label="Bathrooms" type="number" step="0.5" />
          <Field id="list_price" label="List price" type="number" />
          <Field id="dwelling_a" label="Dwelling coverage (A)" type="number" />
          <Field id="personal_property_pct" label="Personal property %" type="number" />
        </div>
      </details>

      <div className="flex flex-wrap items-center gap-4">
        <button type="submit" disabled={isPending || !isVerified} className="rounded bg-[#003049] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
          {isPending ? "Queuing..." : "Run quote now"}
        </button>
        {!isVerified && <span className="text-xs text-slate-500">Verify the address above first.</span>}
        {state && "error" in state && <span className="text-sm text-red-600">{state.error}</span>}
      </div>
    </form>
  );
}
