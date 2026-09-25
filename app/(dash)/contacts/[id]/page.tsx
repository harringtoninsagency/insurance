import Link from "next/link";
import { notFound } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { EVENT_LABEL, METHOD_LABEL } from "@/lib/contacts/consent";
import { ConsentForm } from "./ConsentForm";

const TYPE_LABEL = { realtor: "Realtor", mortgage_broker: "Mortgage broker" } as const;

function Badge({ children, tone }: { children: React.ReactNode; tone: "green" | "amber" | "red" | "grey" }) {
  const tones = {
    green: "bg-green-100 text-green-700",
    amber: "bg-amber-100 text-amber-800",
    red: "bg-red-100 text-red-700",
    grey: "bg-slate-100 text-slate-600",
  };
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>;
}

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : null);

export default async function ContactPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerSupabase();

  const { data: contact } = await supabase.from("industry_contacts").select("*").eq("id", id).single();
  if (!contact) notFound();

  const { data: events } = await supabase
    .from("contact_consent_events")
    .select("*")
    .eq("contact_id", id)
    .order("occurred_at", { ascending: false })
    .order("created_at", { ascending: false });

  const details: Array<[string, string | null]> = [
    ["Company", contact.company_name],
    ["Cell", contact.cell_phone],
    ["Office", contact.office_phone],
    ["Email", contact.email],
    ["License #", contact.license_number],
    ["City", contact.city],
  ];

  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <Link href="/contacts" className="text-xs text-slate-500 hover:underline">
          ← Realtors &amp; brokers
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-[#003049]">{contact.full_name}</h1>
        <div className="mb-2 mt-2 h-[3px] w-16 bg-[#F0FF00]" />
        <p className="text-sm text-slate-500">{TYPE_LABEL[contact.contact_type]}</p>
      </div>

      <section className="grid grid-cols-3 gap-x-6 gap-y-3 rounded-lg border border-slate-200 bg-white p-5 text-sm">
        {details.map(([label, value]) => (
          <div key={label}>
            <div className="text-xs text-slate-500">{label}</div>
            <div className="text-slate-800">{value ?? "—"}</div>
          </div>
        ))}
      </section>

      <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="font-medium text-[#003049]">Where they stand</h2>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {contact.do_not_contact && <Badge tone="red">Do not contact</Badge>}
          {contact.email_consent === "opted_in" && <Badge tone="green">Email: opted in{contact.email_consent_at ? ` ${fmt(contact.email_consent_at)}` : ""}</Badge>}
          {contact.email_consent === "opted_out" && <Badge tone="red">Email: opted out</Badge>}
          {contact.email_consent === "unknown" && <Badge tone="amber">Email: no opt-in on record</Badge>}
          {contact.sms_consent === "written" ? (
            <Badge tone="green">Text: written consent{contact.sms_consent_at ? ` ${fmt(contact.sms_consent_at)}` : ""}</Badge>
          ) : (
            <Badge tone="grey">Text: no consent — don&apos;t text</Badge>
          )}
        </div>
      </section>

      <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="font-medium text-[#003049]">Record consent or an opt-out</h2>
        <p className="text-xs text-slate-500">
          Use this when someone tells you in person, on a form or by reply. Each entry is added to the history below and
          can&apos;t be edited or deleted later.
        </p>
        <ConsentForm contactId={contact.id} cellPhone={contact.cell_phone} />
      </section>

      <section className="space-y-3">
        <h2 className="font-medium text-[#003049]">History</h2>
        {!events?.length ? (
          <p className="text-sm text-slate-500">Nothing recorded yet.</p>
        ) : (
          <ul className="space-y-2">
            {events.map((e) => (
              <li key={e.id} className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium text-slate-800">{EVENT_LABEL[e.event_type]}</span>
                  <span className="text-xs text-slate-500">{new Date(e.occurred_at).toLocaleDateString()}</span>
                </div>
                <div className="text-xs text-slate-500">
                  {METHOD_LABEL[e.method]}
                  {e.contact_cell && e.event_type === "sms_opt_in" ? ` · ${e.contact_cell}` : ""}
                  {e.recorded_by ? ` · recorded by ${e.recorded_by}` : ""}
                </div>
                {e.note && <p className="mt-1 text-slate-700">{e.note}</p>}
                {e.consent_text && (
                  <details className="mt-1 text-xs text-slate-500">
                    <summary className="cursor-pointer">Wording they agreed to{e.ip ? ` (IP ${e.ip})` : ""}</summary>
                    <p className="mt-1 whitespace-pre-wrap">{e.consent_text}</p>
                  </details>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
