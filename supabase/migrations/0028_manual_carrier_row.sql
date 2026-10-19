-- The 5th, customizable row of the listing snapshot's "Preliminary Carrier
-- Indications" table — a carrier a producer quoted/checked by hand (outside
-- Fetch) that didn't come back as one of our own priced quotes. Optional;
-- the row renders blank when unset. See lib/proposals/generate-listing-snapshot.ts.

alter table public.properties
  add column manual_carrier_name text,
  add column manual_carrier_premium numeric;
