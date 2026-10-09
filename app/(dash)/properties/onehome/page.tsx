import Link from "next/link";
import { createServerSupabase } from "@/lib/supabase/server";
import { todayEt, formatDateOnly } from "@/lib/dates";
import { RunQuoteButton } from "../../quote-requests/RunQuoteButton";

interface PropertyRow {
  id: string;
  address: string;
  status: string;
  list_price: number | null;
  listing_agent_name: string | null;
  date_quoted: string | null;
  photo_path: string | null;
  created_at: string;
}

// "2026-10-07" -> "Tuesday, October 7, 2026". Parsed as a plain date (no time
// component), so no time zone shift to worry about here.
function formatDayHeading(dayKey: string): string {
  const [year, month, day] = dayKey.split("-").map(Number);
  const date = new Date(year!, month! - 1, day!);
  return new Intl.DateTimeFormat("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" }).format(date);
}

export default async function OneHomeQueuePage() {
  const supabase = await createServerSupabase();
  const { data: propertiesData, error } = await supabase
    .from("properties")
    .select("id, address, status, list_price, listing_agent_name, date_quoted, photo_path, created_at")
    .eq("source", "onehome")
    .order("created_at", { ascending: false })
    .limit(500);
  const properties = propertiesData as PropertyRow[] | null;

  const queued = properties?.length
    ? await supabase.from("quote_requests").select("property_id").in("status", ["new", "processing"]).not("property_id", "is", null)
    : { data: [] };
  const queuedIds = new Set((queued.data ?? []).map((r) => r.property_id as string));

  const photoPaths = ((properties ?? []) as PropertyRow[]).filter((p): p is PropertyRow & { photo_path: string } => !!p.photo_path);
  const photoUrlByPath = new Map<string, string>();
  if (photoPaths.length) {
    const signed = await Promise.all(photoPaths.map((p) => supabase.storage.from("listing-photos").createSignedUrl(p.photo_path, 3600)));
    photoPaths.forEach((p, i) => {
      const url = signed[i]?.data?.signedUrl;
      if (url) photoUrlByPath.set(p.photo_path, url);
    });
  }

  const byDay = new Map<string, PropertyRow[]>();
  for (const p of properties ?? []) {
    const dayKey = todayEt(new Date(p.created_at));
    const bucket = byDay.get(dayKey);
    if (bucket) bucket.push(p);
    else byDay.set(dayKey, [p]);
  }
  const days = [...byDay.keys()].sort((a, b) => (a < b ? 1 : -1));

  function renderCard(p: PropertyRow) {
    const photoUrl = p.photo_path ? photoUrlByPath.get(p.photo_path) : undefined;
    return (
      <div key={p.id} className="flex gap-3 border-b border-slate-100 px-4 py-3 last:border-0">
        <div className="h-16 w-16 shrink-0 overflow-hidden rounded bg-slate-100">
          {photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photoUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-[10px] text-slate-400">No photo</div>
          )}
        </div>
        <div className="flex-1">
          <Link href={`/properties/${p.id}`} className="font-medium text-[#003049] hover:underline">
            {p.address}
          </Link>
          <div className="mt-0.5 text-xs text-slate-500">
            {p.listing_agent_name ? `${p.listing_agent_name} · ` : ""}
            {p.list_price ? `$${Number(p.list_price).toLocaleString()}` : "Price unknown"}
            {" · Quoted "}
            {formatDateOnly(p.date_quoted)}
          </div>
          <div className="mt-1 flex items-center gap-2">
            <span className="rounded-full bg-[#8291AC]/15 px-2 py-0.5 text-xs font-medium text-[#003049]">{p.status}</span>
            {queuedIds.has(p.id) ? (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">Queued</span>
            ) : (
              <RunQuoteButton propertyId={p.id} compact label="Run quote" />
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-xl font-semibold text-[#003049]">OneHome queue</h1>
      <div className="mb-2 mt-2 h-[3px] w-16 bg-[#F0FF00]" />
      <p className="mb-6 text-sm text-slate-500">
        Listings pulled in by the daily OneHome mailbox ingest, grouped by the day they came in.
      </p>

      {error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error.message}</p>}
      {!error && days.length === 0 && <p className="text-sm text-slate-500">No OneHome listings yet.</p>}

      <div className="space-y-3">
        {days.map((dayKey, i) => {
          const rows = byDay.get(dayKey)!;
          return (
            <details key={dayKey} className="rounded-lg border border-slate-200 bg-white" open={i === 0}>
              <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium text-[#003049]">
                {formatDayHeading(dayKey)} <span className="text-slate-400">({rows.length})</span>
              </summary>
              <div className="border-t border-slate-200">{rows.map(renderCard)}</div>
            </details>
          );
        })}
      </div>
    </div>
  );
}
