import { notFound } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { PullCountyDataButton } from "./PullCountyDataButton";
import { GenerateProposalButton } from "./GenerateProposalButton";
import { GenerateListingSnapshotButton } from "./GenerateListingSnapshotButton";
import { PhotoUploadForm } from "./PhotoUploadForm";
import { EditListingAgentForm } from "./EditListingAgentForm";
import { QueueOutreachForm } from "./QueueOutreachForm";

export default async function PropertyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createServerSupabase();

  // Realtors/brokers offered as recipients when queuing outreach. People who
  // opted out or are marked do-not-contact are left out (and blocked anyway).
  const { data: directoryContacts } = await supabase
    .from("industry_contacts")
    .select("full_name, company_name, email")
    .not("email", "is", null)
    .eq("do_not_contact", false)
    .neq("email_consent", "opted_out")
    .order("full_name")
    .limit(1000);

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

  let photoPreviewUrl: string | null = null;
  if (property.photo_path) {
    const { data } = await supabase.storage.from("listing-photos").createSignedUrl(property.photo_path, 3600);
    photoPreviewUrl = data?.signedUrl ?? null;
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-[#003049]">{property.address}</h1>
        <div className="mb-2 mt-2 h-[3px] w-16 bg-[#F0FF00]" />
        <p className="text-sm text-slate-500">
          {property.year_built ? `Built ${property.year_built}` : "Year built unknown"}
          {property.sqft ? ` · ${property.sqft.toLocaleString()} sqft` : ""}
          {property.construction ? ` · ${property.construction}` : ""}
        </p>
        <span className="mt-2 inline-block rounded-full bg-[#8291AC]/15 px-2 py-1 text-xs font-medium text-[#003049]">
          {property.status}
        </span>
      </div>

      <section>
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase text-[#003049]">
          <span className="inline-block h-2 w-2 shrink-0 bg-[#F0FF00]" />
          Listing agent
        </h2>
        <EditListingAgentForm
          propertyId={property.id}
          name={property.listing_agent_name}
          email={property.listing_agent_email}
          phone={property.listing_agent_phone}
        />
        <p className="mt-1 text-xs text-slate-500">
          Not captured by CSV import today — fill this in from the MLS listing when known.
        </p>
      </section>

      <section>
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase text-[#003049]">
          <span className="inline-block h-2 w-2 shrink-0 bg-[#F0FF00]" />
          Listing photo
        </h2>
        {photoPreviewUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photoPreviewUrl}
            alt={`${property.address} listing photo`}
            className="mb-3 h-48 w-full max-w-md rounded object-cover"
          />
        )}
        <PhotoUploadForm propertyId={property.id} />
        <p className="mt-1 text-xs text-slate-500">
          Save the photo from the MLS/listing site and upload it here — used by the listing snapshot proposal below.
        </p>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase text-[#003049]">
            <span className="inline-block h-2 w-2 shrink-0 bg-[#F0FF00]" />
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
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase text-[#003049]">
          <span className="inline-block h-2 w-2 shrink-0 bg-[#F0FF00]" />
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
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase text-[#003049]">
          <span className="inline-block h-2 w-2 shrink-0 bg-[#F0FF00]" />
          Quotes
        </h2>
        {quotes?.length ? (
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="bg-[#003049] text-xs uppercase text-white">
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
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase text-[#003049]">
            <span className="inline-block h-2 w-2 shrink-0 bg-[#F0FF00]" />
            Proposals
          </h2>
          <div className="flex items-center gap-2">
            <GenerateProposalButton propertyId={property.id} />
            <GenerateListingSnapshotButton propertyId={property.id} />
          </div>
        </div>
        {proposals?.length ? (
          <ul className="space-y-2 text-sm">
            {proposals.map((p) => (
              <li key={p.id} className="flex items-center justify-between rounded border border-slate-200 bg-white px-4 py-2">
                <span className="font-medium capitalize">{p.kind.replace(/_/g, " ")} v{p.version}</span>
                <div className="flex items-center gap-4">
                  <span className="text-slate-500">
                    {new Date(p.created_at).toLocaleDateString()}
                  </span>
                  {proposalDownloadUrls.has(p.id) && (
                    <a
                      href={proposalDownloadUrls.get(p.id)}
                      className="font-medium text-[#003049] hover:underline"
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
          <QueueOutreachForm
            propertyId={property.id}
            proposalId={proposals[0]!.id}
            contacts={(directoryContacts ?? []).map((c) => ({
              email: c.email!,
              label: `${c.full_name}${c.company_name ? ` — ${c.company_name}` : ""}`,
            }))}
          />
        )}
      </section>
    </div>
  );
}
