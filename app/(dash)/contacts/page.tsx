import Link from "next/link";
import { createServerSupabase } from "@/lib/supabase/server";
import { AddContactForm } from "./AddContactForm";
import { ImportContactsForm } from "./ImportContactsForm";
import { DoNotContactButton } from "./DoNotContactButton";

const PAGE_SIZE = 200;

const TYPE_LABEL = { realtor: "Realtor", mortgage_broker: "Mortgage broker" } as const;
const SOURCE_LABEL: Record<string, string> = {
  manual: "Entered by hand",
  csv_import: "CSV / roster",
  listing_agent: "Listing agent",
  public_license: "Public license",
  referral: "Referral",
  event: "Event",
  web_form: "Web form",
  other: "Other",
};

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const type = params.type === "realtor" || params.type === "mortgage_broker" ? params.type : null;
  // Strip characters that would break out of the PostgREST or() filter or act as LIKE wildcards.
  const q = (typeof params.q === "string" ? params.q : "").replace(/[,()%_*\\]/g, " ").trim();

  const supabase = await createServerSupabase();

  let query = supabase
    .from("industry_contacts")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(PAGE_SIZE);
  if (type) query = query.eq("contact_type", type);
  if (q) query = query.or(`full_name.ilike.%${q}%,company_name.ilike.%${q}%,email.ilike.%${q}%`);

  const count = (build: (b: ReturnType<typeof base>) => ReturnType<typeof base>) => build(base());
  function base() {
    return supabase.from("industry_contacts").select("id", { count: "exact", head: true });
  }

  const [{ data: contacts, error }, realtors, brokers, withEmail, withCell] = await Promise.all([
    query,
    count((b) => b.eq("contact_type", "realtor")),
    count((b) => b.eq("contact_type", "mortgage_broker")),
    count((b) => b.not("email", "is", null)),
    count((b) => b.not("cell_phone", "is", null)),
  ]);

  const stats = [
    { label: "Realtors", value: realtors.count ?? 0 },
    { label: "Mortgage brokers", value: brokers.count ?? 0 },
    { label: "With email", value: withEmail.count ?? 0 },
    { label: "With cell phone", value: withCell.count ?? 0 },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-[#003049]">Realtor &amp; mortgage broker directory</h1>
        <div className="mb-2 mt-2 h-[3px] w-16 bg-[#F0FF00]" />
        <p className="text-sm text-slate-500">
          Referral partners in Florida. Every contact records where it came from and what they&apos;ve agreed to
          receive — texting a cell number requires written consent, so &quot;SMS consent&quot; stays blank until it&apos;s documented.
        </p>
      </div>

      <div className="grid grid-cols-4 gap-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-lg border border-slate-200 bg-white px-4 py-3">
            <div className="text-2xl font-semibold text-[#003049]">{s.value.toLocaleString()}</div>
            <div className="text-xs text-slate-500">{s.label}</div>
          </div>
        ))}
      </div>

      <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="font-medium text-[#003049]">Add a contact</h2>
        <AddContactForm />
      </section>

      <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="font-medium text-[#003049]">Import a list</h2>
        <ImportContactsForm />
      </section>

      <section className="space-y-3">
        <form className="flex items-center gap-3 text-sm" method="get">
          <input
            name="q"
            defaultValue={q}
            placeholder="Search name, company or email"
            className="w-72 rounded border border-slate-300 px-2 py-1.5"
          />
          <select name="type" defaultValue={type ?? ""} className="rounded border border-slate-300 px-2 py-1.5">
            <option value="">All types</option>
            <option value="realtor">Realtors</option>
            <option value="mortgage_broker">Mortgage brokers</option>
          </select>
          <button type="submit" className="rounded border border-[#003049] px-3 py-1.5 font-medium text-[#003049]">
            Filter
          </button>
        </form>

        {error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error.message}</p>}
        {!error && contacts?.length === 0 && (
          <p className="text-sm text-slate-500">No contacts match. Add one above, or import a list.</p>
        )}

        {!!contacts?.length && (
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="bg-[#003049] text-xs uppercase text-white">
                <tr>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Company</th>
                  <th className="px-4 py-3">Cell</th>
                  <th className="px-4 py-3">Office</th>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Source</th>
                  <th className="px-4 py-3">Consent</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {contacts.map((c) => (
                  <tr key={c.id} className="border-b border-slate-100 align-top last:border-0">
                    <td className="px-4 py-3">
                      <Link href={`/contacts/${c.id}`} className="font-medium text-[#003049] hover:underline">
                        {c.full_name}
                      </Link>
                      <div className="text-xs text-slate-500">{TYPE_LABEL[c.contact_type]}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{c.company_name ?? "—"}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">{c.cell_phone ?? "—"}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">{c.office_phone ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-600">{c.email ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {SOURCE_LABEL[c.source] ?? c.source}
                      {c.source_detail && <div className="text-xs text-slate-400">{c.source_detail}</div>}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      <div>Email: {c.email_consent.replace("_", " ")}</div>
                      <div>SMS: {c.sms_consent === "written" ? "written consent" : "none"}</div>
                      <Link href={`/contacts/${c.id}`} className="text-[#003049] hover:underline">
                        Record consent
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <DoNotContactButton contactId={c.id} doNotContact={c.do_not_contact} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {contacts?.length === PAGE_SIZE && (
          <p className="text-xs text-slate-500">Showing the {PAGE_SIZE} most recent matches — narrow with search to see others.</p>
        )}
      </section>
    </div>
  );
}
