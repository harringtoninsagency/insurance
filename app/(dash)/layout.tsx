import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";

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
        <div className="mb-6 text-lg font-semibold">FetchRival</div>
        <ul className="space-y-1 text-sm">
          <li>
            <Link
              href="/properties"
              className="block rounded px-3 py-2 hover:bg-slate-100"
            >
              Properties
            </Link>
          </li>
          <li>
            <Link
              href="/review"
              className="block rounded px-3 py-2 hover:bg-slate-100"
            >
              Outreach review
            </Link>
          </li>
        </ul>
      </nav>
      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
