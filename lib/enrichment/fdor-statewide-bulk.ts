// Helpers for Florida's statewide parcel + NAL (Name-Address-Legal real
// property roll) dataset, published by the Florida Geographic Information
// Office (FGIO) and sourced from the Dept. of Revenue's annual county
// submissions — a public, unauthenticated ArcGIS FeatureServer, unlike the
// Dept. of Revenue's own Tax Roll Data Files document library (confirmed via
// a direct curl: that one 401s, SharePoint-authenticated even for "public"
// browsing).
//
// https://geodata.floridagio.gov/datasets/FGIO::florida-statewide-parcels
// Layer: https://services9.arcgis.com/Gh9awoU677aKree0/arcgis/rest/services/Florida_Statewide_Cadastral/FeatureServer/0
//
// Field names match the Dept. of Revenue's own NAL file layout exactly
// (DOR_UC, ACT_YR_BLT, TOT_LVG_AR, PHY_ADDR1, etc.) — confirmed against real
// data pulled from this service, not assumed from the NAL docs alone.
//
// Querying: CO_NO (county number) is indexed and fast; a bare DOR_UC filter
// across the full ~10.9M-row table is not (timed out past 60s). Always
// filter by CO_NO first. A multi-value `DOR_UC IN (...)` also runs far
// slower than single-value equality (16s vs <1s for a count), so this syncs
// one DOR use code at a time per county rather than batching the IN clause.

const QUERY_URL = "https://services9.arcgis.com/Gh9awoU677aKree0/arcgis/rest/services/Florida_Statewide_Cadastral/FeatureServer/0/query";
const PAGE_SIZE = 2000; // the layer's own maxRecordCount

export interface FdorParcelAttributes {
  CO_NO: number;
  PARCEL_ID: string;
  DOR_UC: string;
  ACT_YR_BLT: number | null;
  TOT_LVG_AR: number | null;
  PHY_ADDR1: string | null;
  PHY_ADDR2: string | null;
  PHY_CITY: string | null;
  PHY_ZIPCD: number | null;
  OWN_NAME: string | null;
}

const OUT_FIELDS = "CO_NO,PARCEL_ID,DOR_UC,ACT_YR_BLT,TOT_LVG_AR,PHY_ADDR1,PHY_ADDR2,PHY_CITY,PHY_ZIPCD,OWN_NAME";

// The service fails intermittently under sustained load — not just as a
// non-200 HTTP response, but as a 200 OK carrying `{"error": {...}}` in the
// JSON body (confirmed: the exact same query shape succeeds most of the
// time and fails with "Invalid query parameters" at varying offsets, which
// rules out a real parameter bug). A plain `!res.ok` check misses this
// entirely, so the error check has to happen after parsing the body, inside
// the retry loop, not left to the caller.
//
// Bumped from 6 attempts / 1500ms*attempt to 10 / 2500ms*attempt after
// observing the failure rate climb over several hours of real runs —
// whole counties started failing on every DOR code in a single pass
// (previously just one or two), and large counties' Single Family code
// (the most pages, so the most chances for one page to hit this) was
// failing on effectively every attempt. Longer backoff, more attempts.
//
// Separately: a long-running sync has been observed to go fully silent for
// hours at a time (no further progress, no logged failure either) on
// exactly this call, in a run where an ad-hoc curl to the identical URL
// from the same host succeeded in under a second — i.e. not the documented
// "service is genuinely struggling" case above, but the fetch() call itself
// never settling (resolving or rejecting) despite `AbortSignal.timeout`,
// which a proxy-agent transport isn't guaranteed to honor if it doesn't
// propagate the abort down to the underlying socket. A `Promise.race`
// against an independent timer doesn't depend on fetch() cooperating: it
// guarantees this function itself gives up and retries even if the losing
// fetch promise never resolves (that stray promise is simply abandoned,
// not cancelled — acceptable for a one-off migration script where the
// alternative is the entire run silently wedging for its full time budget).
async function fetchJsonWithRetry<T>(params: URLSearchParams, attempt = 1): Promise<T> {
  try {
    const json = await Promise.race([
      (async () => {
        const res = await fetch(`${QUERY_URL}?${params}`, { signal: AbortSignal.timeout(60_000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as T & { error?: unknown };
      })(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("watchdog: fetch did not settle within 70s")), 70_000)),
    ]);
    if (json.error) throw new Error(`FDOR query error: ${JSON.stringify(json.error)}`);
    return json;
  } catch (err) {
    if (attempt >= 10) throw err;
    const delayMs = 2500 * attempt;
    await new Promise((r) => setTimeout(r, delayMs));
    return fetchJsonWithRetry(params, attempt + 1);
  }
}

/** Total row count for a given county + DOR use code, for progress logging. */
export async function countFdorParcels(countyNo: number, dorUseCode: string): Promise<number> {
  const params = new URLSearchParams({
    where: `CO_NO=${countyNo} AND DOR_UC='${dorUseCode}'`,
    returnCountOnly: "true",
    f: "json",
  });
  const json = await fetchJsonWithRetry<{ count?: number }>(params);
  return json.count ?? 0;
}

/** Pages through every row for a given county + DOR use code. */
export async function* fetchFdorParcels(countyNo: number, dorUseCode: string): AsyncGenerator<FdorParcelAttributes[]> {
  let offset = 0;
  for (;;) {
    const params = new URLSearchParams({
      where: `CO_NO=${countyNo} AND DOR_UC='${dorUseCode}'`,
      outFields: OUT_FIELDS,
      returnGeometry: "false",
      resultOffset: String(offset),
      resultRecordCount: String(PAGE_SIZE),
      f: "json",
    });
    const json = await fetchJsonWithRetry<{ features?: { attributes: FdorParcelAttributes }[] }>(params);
    const rows = (json.features ?? []).map((f) => f.attributes);
    if (rows.length === 0) return;
    yield rows;
    if (rows.length < PAGE_SIZE) return;
    offset += PAGE_SIZE;
  }
}
