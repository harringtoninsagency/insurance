import Link from "next/link";
import { notFound } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { EVENT_LABEL, METHOD_LABEL } from "@/lib/contacts/consent";
import { ConsentForm } from "./ConsentForm";
import { InvitePartnerButton } from "./InvitePartnerButton";
import { ReferralPartnerAgentSelect } from "./ReferralPartnerAgentSelect";
import { FollowUpForm } from "./FollowUpForm";
import { EditContactDetailsForm } from "./EditContactDetailsForm";

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

  const { data: partnerAccount } = await supabase.from("partner_accounts").select("status, invited_at, activated_at").eq("contact_id", id).maybeSingle();

  const { data: teamMembers } = await supabase.from("profiles").select("id, full_name, email").eq("active", true).order("full_name");

  const { data: events } = await supabase
    .from("contact_consent_events")
    .select("*")
    .eq("contact_id", id)
    .order("occurred_at", { ascending: false })
    .order("created_at", { ascending: false });

  const { data: followUps } = await supabase
    .from("contact_follow_ups")
    .select("*")
    .eq("contact_id", id)
    .order("created_at", { ascending: false });

  const nextFollowUpOn = followUps?.find((f) => f.next_follow_up_on)?.next_follow_up_on ?? null;

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

      <section className="grid grid-cols-1 gap-x-6 gap-y-3 rounded-lg border border-slate-200 bg-white p-5 text-sm sm:grid-cols-3">
        <EditContactDetailsForm
          contact={{
            id: contact.id,
            fullName: contact.full_name,
            companyName: contact.company_name,
            cellPhone: contact.cell_phone,
            officePhone: contact.office_phone,
            email: contact.email,
            licenseNumber: contact.license_number,
            city: contact.city,
          }}
        />
        <div>
          <div className="text-xs text-slate-500">Referral partner agent</div>
          <ReferralPartnerAgentSelect
            contactId={contact.id}
            referralPartnerAgent={contact.referral_partner_agent}
            teamMembers={teamMembers ?? []}
          />
        </div>
      </section>

      <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="font-medium text-[#003049]">Partner portal access</h2>
        {!partnerAccount && <p className="text-sm text-slate-500">Not invited yet — they have no access to the portal.</p>}
        {partnerAccount?.status === "invited" && (
          <p className="text-sm text-amber-800">
            Invited {fmt(partnerAccount.invited_at)}, hasn&apos;t activated their account yet.
          </p>
        )}
        {partnerAccount?.status === "active" && (
          <p className="text-sm text-green-700">Active since {fmt(partnerAccount.activated_at)} — can sign in and request quotes.</p>
        )}
        {partnerAccount?.status !== "active" && <InvitePartnerButton contactId={contact.id} hasEmail={!!contact.email} />}
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

      <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-medium text-[#003049]">Follow-up information</h2>
          {nextFollowUpOn && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
              Next follow-up: {fmt(nextFollowUpOn)}
            </span>
          )}
        </div>
        <p className="text-xs text-slate-500">
          Log calls, emails or check-ins with this partner. Each entry is added to the history below and can&apos;t be
          edited or deleted later.
        </p>
        <FollowUpForm contactId={contact.id} />
        {!followUps?.length ? (
          <p className="text-sm text-slate-500">Nothing logged yet.</p>
        ) : (
          <ul className="space-y-2">
            {followUps.map((f) => (
              <li key={f.id} className="rounded-lg border border-slate-200 px-4 py-3 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-xs text-slate-500">{new Date(f.created_at).toLocaleDateString()}</span>
                  {f.next_follow_up_on && (
                    <span className="text-xs font-medium text-amber-800">Next: {fmt(f.next_follow_up_on)}</span>
                  )}
                </div>
                <p className="mt-1 text-slate-700">{f.note}</p>
                {f.recorded_by && <div className="mt-1 text-xs text-slate-500">recorded by {f.recorded_by}</div>}
              </li>
            ))}
          </ul>
        )}
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
