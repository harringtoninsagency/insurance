import Link from "next/link";
import { createServerSupabase } from "@/lib/supabase/server";
import { ReviewActions } from "./ReviewActions";

const TYPE_LABEL = { realtor: "Realtor", mortgage_broker: "Mortgage broker" } as const;

type Standing = { label: string; className: string };

function standing(contact: { do_not_contact: boolean; email_consent: string } | undefined): Standing {
  if (!contact) return { label: "Not in directory", className: "bg-slate-100 text-slate-600" };
  if (contact.do_not_contact) return { label: "Do not contact", className: "bg-red-100 text-red-700" };
  if (contact.email_consent === "opted_out") return { label: "Opted out", className: "bg-red-100 text-red-700" };
  if (contact.email_consent === "opted_in") return { label: "Opted in", className: "bg-green-100 text-green-700" };
  return { label: "No opt-in on record", className: "bg-amber-100 text-amber-800" };
}

export default async function ReviewPage() {
  const supabase = await createServerSupabase();
  const { data: pending, error } = await supabase
    .from("outreach")
    .select("id, recipient, status, created_at, proposal_id, contact_id")
    .eq("status", "pending_review")
    .order("created_at", { ascending: true });

  // Context for each item: which property/proposal it carries and who the
  // recipient is in the directory (fetched separately — small, agency-scoped sets).
  const proposalIds = [...new Set((pending ?? []).map((o) => o.proposal_id))];
  const contactIds = [...new Set((pending ?? []).map((o) => o.contact_id).filter((id): id is string => !!id))];

  const { data: proposals } = proposalIds.length
    ? await supabase.from("proposals").select("id, kind, version, property_id").in("id", proposalIds)
    : { data: [] };
  const propertyIds = [...new Set((proposals ?? []).map((p) => p.property_id))];
  const [{ data: properties }, { data: contacts }] = await Promise.all([
    propertyIds.length ? supabase.from("properties").select("id, address").in("id", propertyIds) : { data: [] },
    contactIds.length ? supabase.from("industry_contacts").select("*").in("id", contactIds) : { data: [] },
  ]);

  const proposalById = new Map((proposals ?? []).map((p) => [p.id, p]));
  const propertyById = new Map((properties ?? []).map((p) => [p.id, p]));
  const contactById = new Map((contacts ?? []).map((c) => [c.id, c]));

  return (
    <div>
      <h1 className="text-xl font-semibold text-[#003049]">Outreach review</h1>
      <div className="mb-2 mt-2 h-[3px] w-16 bg-[#F0FF00]" />
      <p className="mb-6 text-sm text-slate-500">
        Generated indications land here first. Nothing sends until a producer approves it. People marked
        do-not-contact or opted out can&apos;t be approved.
      </p>

      {error && (
        <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">
          {error.message}
        </p>
      )}

      {!error && pending?.length === 0 && (
        <p className="text-sm text-slate-500">
          Nothing pending review. Queue one from a property&apos;s Proposals section.
        </p>
      )}

      {!!pending?.length && (
        <ul className="space-y-2">
          {pending.map((item) => {
            const contact = item.contact_id ? contactById.get(item.contact_id) : undefined;
            const proposal = proposalById.get(item.proposal_id);
            const property = proposal ? propertyById.get(proposal.property_id) : undefined;
            const s = standing(contact);
            return (
              <li
                key={item.id}
                className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm"
              >
                <div className="space-y-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{contact ? contact.full_name : item.recipient}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${s.className}`}>{s.label}</span>
                  </p>
                  {contact && (
                    <p className="text-slate-600">
                      {TYPE_LABEL[contact.contact_type]}
                      {contact.company_name ? ` · ${contact.company_name}` : ""} · {item.recipient}
                    </p>
                  )}
                  {proposal && property && (
                    <p className="text-slate-600">
                      <span className="capitalize">{proposal.kind.replace(/_/g, " ")} v{proposal.version}</span> for{" "}
                      <Link href={`/properties/${proposal.property_id}`} className="font-medium text-[#003049] hover:underline">
                        {property.address}
                      </Link>
                    </p>
                  )}
                  <p className="text-slate-500">Queued {new Date(item.created_at).toLocaleString()}</p>
                </div>
                <ReviewActions outreachId={item.id} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
