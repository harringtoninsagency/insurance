import Link from "next/link";
import { createServerSupabase } from "@/lib/supabase/server";

export default async function PropertiesPage() {
  const supabase = await createServerSupabase();
  const { data: properties, error } = await supabase
    .from("properties")
    .select("id, address, status, list_price, listing_agent_name, created_at")
    .order("created_at", { ascending: false });

  return (
    <div>
      <h1 className="mb-6 text-xl font-semibold">Properties</h1>

      {error && (
        <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">
          {error.message}
        </p>
      )}

      {!error && properties?.length === 0 && (
        <p className="text-sm text-slate-500">
          No properties yet. Listing ingest lands in Phase 3 — for now, rows
          can be added directly in Supabase Studio to test this screen.
        </p>
      )}

      {!!properties?.length && (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Address</th>
                <th className="px-4 py-3">Listing agent</th>
                <th className="px-4 py-3">List price</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {properties.map((p) => (
                <tr key={p.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-3">
                    <Link
                      href={`/properties/${p.id}`}
                      className="font-medium text-slate-900 hover:underline"
                    >
                      {p.address}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {p.listing_agent_name ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {p.list_price ? `$${Number(p.list_price).toLocaleString()}` : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium">
                      {p.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
