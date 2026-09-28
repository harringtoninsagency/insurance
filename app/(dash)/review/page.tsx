import Link from "next/link";
import { createServerSupabase } from "@/lib/supabase/server";
import { loadEmailConfig } from "@/lib/email/config";
import { ReviewActions } from "./ReviewActions";
import { SendAllButton, SendOneButton } from "./SendButtons";

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
  const emailConfig = loadEmailConfig();

  const columns = "id, recipient, status, created_at, sent_at, send_error, proposal_id, contact_id";
  const [pendingRes, approvedRes, recentRes] = await Promise.all([
    supabase.from("outreach").select(columns).eq("status", "pending_review").order("created_at", { ascending: true }),
    // sent_at is the "claimed for sending" marker, so an approved item with it set is mid-send, not waiting.
    supabase.from("outreach").select(columns).eq("status", "approved").is("sent_at", null).order("created_at", { ascending: true }),
    supabase.from("outreach").select(columns).in("status", ["sent", "bounced"]).order("sent_at", { ascending: false }).limit(15),
  ]);
  const error = pendingRes.error ?? approvedRes.error ?? recentRes.error;
  const pending = pendingRes.data ?? [];
  const approved = approvedRes.data ?? [];
  const recent = recentRes.data ?? [];
  const all = [...pending, ...approved, ...recent];

  // Context for each item: which property/proposal it carries and who the
  // recipient is in the directory (fetched separately — small, agency-scoped sets).
  const proposalIds = [...new Set(all.map((o) => o.proposal_id))];
  const contactIds = [...new Set(all.map((o) => o.contact_id).filter((id): id is string => !!id))];

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

  function Details({ item }: { item: (typeof all)[number] }) {
    const contact = item.contact_id ? contactById.get(item.contact_id) : undefined;
    const proposal = proposalById.get(item.proposal_id);
    const property = proposal ? propertyById.get(proposal.property_id) : undefined;
    const s = standing(contact);
    return (
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
      </div>
    );
  }

  const card = "flex items-center justify-between gap-4 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm";
  const heading = "mb-2 mt-8 flex items-center gap-2 text-sm font-semibold uppercase text-[#003049]";

  return (
    <div>
      <h1 className="text-xl font-semibold text-[#003049]">Outreach review</h1>
      <div className="mb-2 mt-2 h-[3px] w-16 bg-[#F0FF00]" />
      <p className="mb-6 text-sm text-slate-500">
        Generated proposals land here first. Nothing sends until a producer approves it and then clicks Send. People
        marked do-not-contact or opted out can&apos;t be approved or sent to.
      </p>

      {!emailConfig.ok && (
        <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-medium">Email sending isn&apos;t set up yet, so Send is disabled.</p>
          <p className="mt-1">Still to configure: {emailConfig.missing.join("; ")}. See docs/email-setup.md.</p>
        </div>
      )}

      {error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error.message}</p>}

      <h2 className={heading}>
        <span className="inline-block h-2 w-2 shrink-0 bg-[#F0FF00]" />
        Pending review
      </h2>
      {!error && pending.length === 0 && (
        <p className="text-sm text-slate-500">Nothing pending review. Queue one from a property&apos;s Proposals section.</p>
      )}
      {!!pending.length && (
        <ul className="space-y-2">
          {pending.map((item) => (
            <li key={item.id} className={card}>
              <div className="space-y-1">
                <Details item={item} />
                <p className="text-slate-500">Queued {new Date(item.created_at).toLocaleString()}</p>
              </div>
              <ReviewActions outreachId={item.id} />
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center justify-between">
        <h2 className={heading}>
          <span className="inline-block h-2 w-2 shrink-0 bg-[#F0FF00]" />
          Approved — ready to send
        </h2>
        {!!approved.length && <SendAllButton count={approved.length} disabled={!emailConfig.ok} />}
      </div>
      {approved.length === 0 ? (
        <p className="text-sm text-slate-500">Nothing approved is waiting to be sent.</p>
      ) : (
        <ul className="space-y-2">
          {approved.map((item) => (
            <li key={item.id} className={card}>
              <div className="space-y-1">
                <Details item={item} />
                {item.send_error && <p className="text-xs text-red-600">Last attempt failed: {item.send_error}</p>}
              </div>
              <SendOneButton outreachId={item.id} disabled={!emailConfig.ok} />
            </li>
          ))}
        </ul>
      )}

      <h2 className={heading}>
        <span className="inline-block h-2 w-2 shrink-0 bg-[#F0FF00]" />
        Recently sent
      </h2>
      {recent.length === 0 ? (
        <p className="text-sm text-slate-500">Nothing sent yet.</p>
      ) : (
        <ul className="space-y-2">
          {recent.map((item) => (
            <li key={item.id} className={card}>
              <div className="space-y-1">
                <Details item={item} />
                {item.send_error && <p className="text-xs text-red-600">{item.send_error}</p>}
              </div>
              <div className="text-right text-xs text-slate-500">
                <span
                  className={`rounded-full px-2 py-0.5 font-medium ${
                    item.status === "bounced" ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"
                  }`}
                >
                  {item.status === "bounced" ? "Bounced" : "Sent"}
                </span>
                {item.sent_at && <p className="mt-1">{new Date(item.sent_at).toLocaleString()}</p>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
