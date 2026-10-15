import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import brightwayLogo from "@/assets/branding/brightway-harrington-horizontal-deep-blue.png";
import { SignOutButton } from "./SignOutButton";

// A route group, not a URL segment: this wraps only the gated portal pages
// (/partner, /partner/new, ...). /partner/login and /partner/accept-invite
// are separate sibling routes under app/partner/ and never pass through here
// — see node_modules/next/dist/docs/.../route-groups.md, "opting specific
// route segments into sharing a layout, while keeping others out".
export default async function PartnerPortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/partner/login");
  }

  // An active admin gets in without a partner_accounts row at all — they
  // view every partner's activity here, not one partner's, via the same
  // "agency scoped" RLS policies (quote_requests/properties/proposals) the
  // internal dashboard already relies on; current_partner_contact_id()
  // simply never applies to them. See submitPartnerQuoteRequestAction in
  // ./actions.ts for why the "New request" form stays partner-only below.
  const { data: profile } = await supabase.from("profiles").select("role, active").eq("id", user.id).maybeSingle();
  const isAdminView = profile?.role === "admin" && profile.active;

  let contactName: string | null = null;
  if (!isAdminView) {
    const { data: account } = await supabase
      .from("partner_accounts")
      .select("id, status, contact_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!account || account.status !== "active") {
      // Not a recognized, active partner (could be an internal producer
      // session that wandered in, or an invite that was disabled) — sign out
      // rather than leave a half-valid session sitting around.
      await supabase.auth.signOut();
      redirect("/partner/login");
    }

    const { data: contact } = await supabase.from("industry_contacts").select("full_name").eq("id", account.contact_id).maybeSingle();
    contactName = contact?.full_name ?? "Partner";
  }

  return (
    <div className="min-h-screen bg-[#003049] p-2 md:p-4">
      <div className="mx-auto max-w-4xl overflow-hidden rounded-lg bg-white shadow-lg">
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex flex-wrap items-center justify-between gap-3 px-5 py-4">
            <Image src={brightwayLogo} alt="Brightway Insurance | The Harrington Agency" className="h-auto w-32 sm:w-48" priority />
            <div className="flex items-center gap-4 text-sm">
              <Link href="/partner" className="font-medium text-[#003049] hover:underline">
                My requests
              </Link>
              <span className="hidden text-slate-400 sm:inline">{isAdminView ? "Admin view — all partners" : contactName}</span>
              <SignOutButton />
            </div>
          </div>
          <div className="h-[3px] w-full bg-[#F0FF00]" />
        </header>
        <main className="px-5 py-8">{children}</main>
        <footer className="border-t border-slate-200 px-5 py-4 text-center text-xs text-slate-500">
          {/* iOS has no automatic install prompt (unlike Android's
              beforeinstallprompt flow) — Share -> Add to Home Screen is the
              only path, so it has to be told rather than offered. */}
          <p className="mb-2">
            Tip: add this to your home screen for one-tap access — tap <strong>Share</strong> then{" "}
            <strong>Add to Home Screen</strong> on iPhone, or your browser menu&apos;s <strong>Install app</strong> on Android.
          </p>
          Questions? Contact us at{" "}
          <a href="mailto:harringtonagency@brightway.com" className="font-medium text-[#003049] hover:underline">
            harringtonagency@brightway.com
          </a>{" "}
          or{" "}
          <a href="tel:+17277892200" className="font-medium text-[#003049] hover:underline">
            727-789-2200
          </a>
          .
        </footer>
      </div>
    </div>
  );
}
