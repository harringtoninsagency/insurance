import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import brightwayLogo from "@/assets/branding/brightway-harrington-horizontal-deep-blue.png";

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
              Realtors &amp; brokers
            </Link>
          </li>
        </ul>
      </nav>
      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
