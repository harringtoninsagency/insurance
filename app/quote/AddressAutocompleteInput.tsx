"use client";

import { useEffect, useRef, useState } from "react";
import Script from "next/script";

interface GooglePlace {
  formatted_address?: string;
  address_components?: Array<{ long_name: string; short_name: string; types: string[] }>;
}

interface GoogleAutocomplete {
  addListener: (event: string, handler: () => void) => void;
  getPlace: () => GooglePlace;
}

declare global {
  interface Window {
    google?: {
      maps: {
        places: {
          Autocomplete: new (input: HTMLInputElement, opts?: Record<string, unknown>) => GoogleAutocomplete;
        };
      };
    };
  }
}

export interface ParsedAddress {
  formattedAddress: string;
  addressLine: string;
  city: string;
  state: string;
  zipcode: string;
}

function componentValue(place: GooglePlace, type: string, useShort = false): string {
  const match = place.address_components?.find((c) => c.types.includes(type));
  return match ? (useShort ? match.short_name : match.long_name) : "";
}

/** Null when Google didn't return enough to actually submit a quote request (no street number/route, or no city). */
function parsePlace(place: GooglePlace): ParsedAddress | null {
  if (!place.address_components) return null;
  const addressLine = [componentValue(place, "street_number"), componentValue(place, "route")].filter(Boolean).join(" ");
  const city = componentValue(place, "locality") || componentValue(place, "sublocality") || componentValue(place, "postal_town");
  if (!addressLine || !city) return null;
  return {
    formattedAddress: place.formatted_address ?? addressLine,
    addressLine,
    city,
    state: componentValue(place, "administrative_area_level_1", true),
    zipcode: componentValue(place, "postal_code"),
  };
}

const inputClass =
  "w-full rounded border border-slate-300 bg-white px-4 py-3 text-base text-slate-900 focus:border-[#003049] focus:outline-none";

/**
 * A single visible address field backed by Google Places Autocomplete —
 * the "verifies through Google Maps" ask: the visitor sees one box, but
 * selecting a suggestion is what actually fills in the structured
 * addressLine/city/state/zipcode this app's quoting pipeline needs (same
 * shape every other quote-request path already submits). Typing without
 * picking a suggestion never counts as a valid address — onSelect(null)
 * clears it so the form can't be submitted on an unverified guess.
 */
export function AddressAutocompleteInput({ onSelect }: { onSelect: (address: ParsedAddress | null) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [scriptLoaded, setScriptLoaded] = useState(false);
  const [text, setText] = useState("");
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

  useEffect(() => {
    if (!scriptLoaded || !inputRef.current || !window.google) return;
    const autocomplete = new window.google.maps.places.Autocomplete(inputRef.current, {
      componentRestrictions: { country: "us" },
      fields: ["address_components", "formatted_address"],
      types: ["address"],
    });
    autocomplete.addListener("place_changed", () => {
      const parsed = parsePlace(autocomplete.getPlace());
      setText(parsed?.formattedAddress ?? inputRef.current?.value ?? "");
      onSelect(parsed);
    });
    // Re-running this on every render would attach a second listener —
    // scriptLoaded only flips once, so this effect only ever runs once too.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scriptLoaded]);

  return (
    <>
      {apiKey && (
        <Script src={`https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`} strategy="afterInteractive" onLoad={() => setScriptLoaded(true)} />
      )}
      <input
        ref={inputRef}
        type="text"
        placeholder="Start typing your home address..."
        autoComplete="off"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          onSelect(null);
        }}
        className={inputClass}
        required
      />
      {!apiKey && <p className="mt-1 text-xs text-red-600">Address lookup isn&apos;t configured — contact the site owner.</p>}
    </>
  );
}
