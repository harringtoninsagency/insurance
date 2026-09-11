import { notFound } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { PullCountyDataButton } from "./PullCountyDataButton";
import { GenerateProposalButton } from "./GenerateProposalButton";
import { QueueOutreachForm } from "./QueueOutreachForm";

export default async function PropertyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createServerSupabase();

  const [{ data: property }, { data: enrichment }, { data: riskProfile }, { data: quotes }, { data: proposals }] =
    await Promise.all([
      supabase.from("properties").select("*").eq("id", id).single(),
      supabase
        .from("enrichments")
        .select("*")
        .eq("property_id", id)
        .order("fetched_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("risk_profiles")
        .select("*")
        .eq("property_id", id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("quotes")
        .select("*")
        .eq("property_id", id)
        .order("premium", { ascending: true }),
      supabase
        .from("proposals")
        .select("*")
        .eq("property_id", id)
        .order("created_at", { ascending: false }),
    ]);

  if (!property) {
    notFound();
  }

  const proposalDownloadUrls = new Map<string, string>();
  const proposalsWithPath = proposals?.filter((p) => p.pdf_path) ?? [];
  if (proposalsWithPath.length) {
    const signed = await Promise.all(
      proposalsWithPath.map((p) => supabase.storage.from("proposals").createSignedUrl(p.pdf_path!, 3600))
    );
    proposalsWithPath.forEach((p, i) => {
      const url = signed[i]?.data?.signedUrl;
      if (url) proposalDownloadUrls.set(p.id, url);
    });
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold">{property.address}</h1>
        <p className="text-sm text-slate-500">
          {property.year_built ? `Built ${property.year_built}` : "Year built unknown"}
          {property.sqft ? ` · ${property.sqft.toLocaleString()} sqft` : ""}
          {property.construction ? ` · ${property.construction}` : ""}
        </p>
        <span className="mt-2 inline-block rounded-full bg-slate-100 px-2 py-1 text-xs font-medium">
          {property.status}
        </span>
      </div>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase text-slate-500">
          Listing agent
        </h2>
        <dl className="grid grid-cols-3 gap-4 text-sm">
          <div>
            <dt className="text-slate-500">Name</dt>
            <dd>{property.listing_agent_name ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Email</dt>
            <dd>{property.listing_agent_email ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Phone</dt>
            <dd>{property.listing_agent_phone ?? "—"}</dd>
          </div>
        </dl>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase text-slate-500">
            Enrichment
          </h2>
          <PullCountyDataButton propertyId={property.id} />
        </div>
        {enrichment ? (
          <dl className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <dt className="text-slate-500">Flood zone</dt>
              <dd>{enrichment.flood_zone ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Wind-borne debris region</dt>
              <dd>{enrichment.wind_borne_debris_region ? "Yes" : "No"}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Distance to coast</dt>
              <dd>
                {enrichment.dist_to_coast_miles != null
                  ? `${enrichment.dist_to_coast_miles} mi`
                  : "—"}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="text-sm text-slate-500">
            Not enriched yet — click "Pull county data" for year built/sqft/construction from the
            Pinellas County Property Appraiser. Flood zone and wind-borne debris region aren't wired
            up yet (no free authoritative source for the latter).
          </p>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase text-slate-500">
          Risk profile
        </h2>
        {riskProfile ? (
          <pre className="overflow-x-auto rounded bg-slate-900 p-4 text-xs text-slate-100">
            {JSON.stringify(riskProfile.wind_mit_credit_vector ?? riskProfile.underwriting_inputs, null, 2)}
          </pre>
        ) : (
          <p className="text-sm text-slate-500">
            No risk profile yet — built from the FL rate model and wind-mit credit engine in Phase 4.
          </p>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase text-slate-500">
          Quotes
        </h2>
        {quotes?.length ? (
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Carrier</th>
                  <th className="px-4 py-3">Adapter</th>
                  <th className="px-4 py-3">Premium</th>
                  <th className="px-4 py-3">Indicative?</th>
                </tr>
              </thead>
              <tbody>
                {quotes.map((q) => (
                  <tr key={q.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-3 font-medium">{q.carrier}</td>
                    <td className="px-4 py-3 text-slate-600">{q.adapter}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {q.premium ? `$${Number(q.premium).toLocaleString()}` : "—"}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {q.is_indicative ? "Indicative" : "Firm"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-slate-500">
            No quotes yet — ask Claude to run Fetch quoting for this property.
          </p>
        )}
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase text-slate-500">
            Proposals
          </h2>
          <GenerateProposalButton propertyId={property.id} />
        </div>
        {proposals?.length ? (
          <ul className="space-y-2 text-sm">
            {proposals.map((p) => (
              <li key={p.id} className="flex items-center justify-between rounded border border-slate-200 bg-white px-4 py-2">
                <span className="font-medium capitalize">{p.kind} v{p.version}</span>
                <div className="flex items-center gap-4">
                  <span className="text-slate-500">
                    {new Date(p.created_at).toLocaleDateString()}
                  </span>
                  {proposalDownloadUrls.has(p.id) && (
                    <a
                      href={proposalDownloadUrls.get(p.id)}
                      className="font-medium text-slate-900 hover:underline"
                    >
                      Download
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-500">No proposals generated yet.</p>
        )}
        {!!proposals?.length && (
          <QueueOutreachForm propertyId={property.id} proposalId={proposals[0]!.id} />
        )}
      </section>
    </div>
  );
}
