import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import brightwayLogo from "@/assets/branding/brightway-harrington-horizontal-deep-blue.png";
import { SignOutButton } from "./SignOutButton";

export default async function DashLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // A logged-in session isn't necessarily an internal one — a partner account
  // (realtor/mortgage broker) is a real Supabase Auth user too, just with no
  // profiles row. RLS already returns them zero rows anywhere in here, but
  // send them to their own portal rather than showing internal-looking chrome.
  const { data: profile } = await supabase.from("profiles").select("id, role, active, full_name, email").eq("id", user.id).maybeSingle();
  if (!profile) {
    redirect("/partner");
  }
  // RLS already hands a deactivated user zero rows everywhere (see
  // current_agency_id()), so show a plain explanation instead of empty pages.
  if (!profile.active) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="max-w-sm space-y-3 text-center">
          <h1 className="text-lg font-semibold text-[#003049]">This account has been deactivated</h1>
          <p className="text-sm text-slate-600">Ask an admin at your agency if you think that&apos;s a mistake.</p>
          <SignOutButton />
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen">
      <nav className="w-56 shrink-0 border-r border-slate-200 bg-white p-4">
        <Image src={brightwayLogo} alt="Brightway Insurance | The Harrington Agency" className="h-auto w-full" priority />
        <div className="mb-2 mt-3 h-[3px] w-full bg-[#F0FF00]" />
        <div className="mb-4 text-xs text-[#8291AC]">FetchRival</div>
        <ul className="space-y-1 text-sm">
          <li>
            <Link
              href="/properties"
              className="block rounded px-3 py-2 font-medium text-[#003049] hover:bg-[#003049]/5"
            >
              Properties
            </Link>
          </li>
          <li>
            <Link
              href="/properties/onehome"
              className="block rounded px-3 py-2 font-medium text-[#003049] hover:bg-[#003049]/5"
            >
              OneHome queue
            </Link>
          </li>
          <li>
            <Link
              href="/quote-requests"
              className="block rounded px-3 py-2 font-medium text-[#003049] hover:bg-[#003049]/5"
            >
              Quote requests
            </Link>
          </li>
          <li>
            <Link
              href="/review"
              className="block rounded px-3 py-2 font-medium text-[#003049] hover:bg-[#003049]/5"
            >
              Outreach review
            </Link>
          </li>
          <li>
            <Link
              href="/contacts"
              className="block rounded px-3 py-2 font-medium text-[#003049] hover:bg-[#003049]/5"
            >
              Realtors &amp; Brokers
            </Link>
          </li>
          {profile.role === "admin" && (
            <li>
              <Link
                href="/team"
                className="block rounded px-3 py-2 font-medium text-[#003049] hover:bg-[#003049]/5"
              >
                Team
              </Link>
            </li>
          )}
        </ul>
        <div className="mt-8 space-y-2 border-t border-slate-200 pt-4">
          <div className="text-xs">
            <div className="truncate font-medium text-slate-800">{profile.full_name ?? profile.email}</div>
            <div className="text-slate-500">{profile.role === "admin" ? "Admin" : "Agent"}</div>
          </div>
          <SignOutButton />
        </div>
      </nav>
      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
