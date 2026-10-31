"use client";

import { useEffect, useRef, useState } from "react";
import Script from "next/script";

interface GoogleAddressComponent {
  longText?: string | null;
  shortText?: string | null;
  types: string[];
}

interface GooglePlace {
  formattedAddress?: string | null;
  addressComponents?: GoogleAddressComponent[];
  fetchFields: (opts: { fields: string[] }) => Promise<void>;
}

interface GooglePlacePrediction {
  toPlace: () => GooglePlace;
}

interface GooglePlaceAutocompleteElement extends HTMLElement {
  includedRegionCodes?: string[];
  includedPrimaryTypes?: string[];
  placeholder?: string;
}

declare global {
  interface Window {
    google?: {
      maps: {
        importLibrary: (library: "places") => Promise<{
          PlaceAutocompleteElement: new () => GooglePlaceAutocompleteElement;
        }>;
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

function componentValue(components: GoogleAddressComponent[], type: string, useShort = false): string {
  const match = components.find((c) => c.types.includes(type));
  if (!match) return "";
  return (useShort ? match.shortText : match.longText) ?? "";
}

/** Null when Google didn't return enough to actually submit a quote request (no street number/route, or no city). */
function parsePlace(place: GooglePlace): ParsedAddress | null {
  const components = place.addressComponents;
  if (!components) return null;
  const addressLine = [componentValue(components, "street_number"), componentValue(components, "route")].filter(Boolean).join(" ");
  const city = componentValue(components, "locality") || componentValue(components, "sublocality") || componentValue(components, "postal_town");
  if (!addressLine || !city) return null;
  return {
    formattedAddress: place.formattedAddress ?? addressLine,
    addressLine,
    city,
    state: componentValue(components, "administrative_area_level_1", true),
    zipcode: componentValue(components, "postal_code"),
  };
}

/**
 * A single visible address field backed by Google's Place Autocomplete
 * widget — the "verifies through Google Maps" ask: the visitor sees one
 * box, but selecting a suggestion is what actually fills in the structured
 * addressLine/city/state/zipcode this app's quoting pipeline needs (same
 * shape every other quote-request path already submits). Typing without
 * picking a suggestion never counts as a valid address — onSelect(null)
 * clears it so the form can't be submitted on an unverified guess.
 *
 * Uses the current PlaceAutocompleteElement, not the older
 * google.maps.places.Autocomplete constructor: as of March 2025 that one is
 * no longer available to new Google Cloud projects (confirmed live — this
 * project's console only offers "Places API (New)", not the classic
 * "Places API" the old constructor needs), so this is the only version that
 * works for this API key.
 */
export function AddressAutocompleteInput({ onSelect }: { onSelect: (address: ParsedAddress | null) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scriptLoaded, setScriptLoaded] = useState(false);
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

  useEffect(() => {
    if (!scriptLoaded || !containerRef.current || !window.google) return;
    const container = containerRef.current;
    let cancelled = false;
    let placeAutocomplete: GooglePlaceAutocompleteElement | null = null;

    (async () => {
      // The script's onLoad firing doesn't mean google.maps.places is
      // populated yet — with loading=async (Google's current recommended
      // flag, confirmed live: dropping it just trades this race for a
      // "loaded without loading=async" console warning) that happens
      // slightly later. importLibrary's promise is what actually waits for
      // it; reading window.google.maps.places directly after onLoad raced
      // it and threw "Cannot read properties of undefined" in production.
      const { PlaceAutocompleteElement } = await window.google!.maps.importLibrary("places");
      if (cancelled || !container) return;

      placeAutocomplete = new PlaceAutocompleteElement();
      placeAutocomplete.includedRegionCodes = ["us"];
      placeAutocomplete.includedPrimaryTypes = ["street_address"];
      placeAutocomplete.placeholder = "Start typing your home address...";
      // Only these properties are documented as overridable on the host
      // element (border/background/font) — padding and height aren't, so
      // the element's own built-in sizing still governs those.
      placeAutocomplete.style.width = "100%";
      placeAutocomplete.style.display = "block";
      placeAutocomplete.style.border = "1px solid #cbd5e1";
      placeAutocomplete.style.borderRadius = "0.25rem";
      placeAutocomplete.style.backgroundColor = "#ffffff";
      placeAutocomplete.style.fontSize = "1rem";
      placeAutocomplete.style.color = "#0f172a";
      container.appendChild(placeAutocomplete);

      placeAutocomplete.addEventListener("gmp-select", async (event) => {
        const { placePrediction } = event as unknown as { placePrediction: GooglePlacePrediction };
        const place = placePrediction.toPlace();
        await place.fetchFields({ fields: ["addressComponents", "formattedAddress"] });
        onSelect(parsePlace(place));
      });

      // Typing again after a selection has to invalidate it — otherwise a
      // stale, previously-selected address could still submit even though
      // the visible text no longer matches it. "input" is a standard DOM
      // event; the element's own "gmp-select" handler above runs and sets a
      // fresh selection after this fires for the same keystroke that
      // completes it, so the two don't fight each other.
      placeAutocomplete.addEventListener("input", () => onSelect(null));
    })();

    // Re-running this on every render would create a second element —
    // scriptLoaded only flips once, so this effect only ever runs once too.
    return () => {
      cancelled = true;
      if (placeAutocomplete) container.removeChild(placeAutocomplete);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scriptLoaded]);

  return (
    <>
      {apiKey && (
        <Script
          src={`https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places&loading=async`}
          strategy="afterInteractive"
          onLoad={() => setScriptLoaded(true)}
        />
      )}
      <div ref={containerRef} />
      {!apiKey && <p className="mt-1 text-xs text-red-600">Address lookup isn&apos;t configured — contact the site owner.</p>}
    </>
  );
}
