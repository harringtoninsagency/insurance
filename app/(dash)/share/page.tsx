import QRCode from "qrcode";
import { appBaseUrl } from "@/lib/base-url";
import { createServerSupabase } from "@/lib/supabase/server";
import { CopyLinkButton } from "./CopyLinkButton";
import { ShareImageActions } from "./ShareImageActions";

export const metadata = { title: "Share with a partner" };

interface AgentLink {
  id: string;
  label: string;
  url: string;
  qrSvg: string;
}

export default async function SharePage() {
  const supabase = await createServerSupabase();
  const { data: teamMembers } = await supabase.from("profiles").select("id, full_name, email").eq("active", true).order("full_name");

  const base = appBaseUrl();
  const agentLinks: AgentLink[] = await Promise.all(
    (teamMembers ?? []).map(async (m) => {
      const url = `${base}/partner/signup?agent=${m.id}`;
      // Deep blue instead of pure black to match the brand, but still dark
      // enough for a phone camera to read reliably.
      const qrSvg = await QRCode.toString(url, {
        type: "svg",
        color: { dark: "#003049", light: "#FFFFFF" },
        margin: 1,
        width: 180,
      });
      return { id: m.id, label: m.full_name ?? m.email, url, qrSvg };
    })
  );

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-semibold text-[#003049]">Share with a partner</h1>
      <div className="mb-2 mt-2 h-[3px] w-16 bg-[#F0FF00]" />
      <p className="mb-6 text-sm text-slate-500">
        Each agent below has their own sign-up link and QR code. Hand a realtor, mortgage broker, or roofing
        company that agent&apos;s link — at a showing, closing, or anywhere else — and any quote request they
        submit afterward is automatically assigned to that agent. Once they&apos;re signed in, they can{" "}
        <a
          href="https://developer.mozilla.org/en-US/docs/Web/Progressive_Web_Apps/Add_to_home_screen"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[#003049] hover:underline"
        >
          add it to their phone&apos;s home screen
        </a>{" "}
        like a regular app.
      </p>

      {agentLinks.length === 0 && <p className="text-sm text-slate-500">No active team members yet.</p>}

      <div className="space-y-6">
        {agentLinks.map((a) => (
          <div key={a.id} className="rounded-lg border border-slate-200 bg-white p-6">
            <h2 className="text-base font-semibold text-[#003049]">{a.label}</h2>

            <div className="mt-4 flex flex-col items-center gap-5 text-center sm:flex-row sm:items-start sm:text-left">
              <div
                className="shrink-0 rounded border border-slate-200 p-2"
                // qrSvg is generated server-side from a URL this app itself
                // built (appBaseUrl() + a fixed path + this agent's own id) —
                // no user input ever reaches it.
                dangerouslySetInnerHTML={{ __html: a.qrSvg }}
              />
              <div className="flex-1 space-y-3">
                <div>
                  <div className="text-xs font-medium uppercase text-slate-400">Sign-up link</div>
                  <div className="mt-1 break-all rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-[#003049]">{a.url}</div>
                </div>
                <CopyLinkButton url={a.url} />
              </div>
            </div>

            <div className="mt-5 flex flex-col items-center gap-4 border-t border-slate-100 pt-5 sm:flex-row sm:items-start">
              {/* eslint-disable-next-line @next/next/no-img-element -- server-generated PNG via a route handler, not an optimizable static asset */}
              <img
                src={`/share/og?agent=${a.id}`}
                alt={`Shareable sign-up graphic for ${a.label}`}
                width={110}
                height={110}
                className="shrink-0 rounded-lg border border-slate-200"
              />
              <div className="space-y-2">
                <ShareImageActions
                  imageUrl={`/share/og?agent=${a.id}`}
                  shareText={`Get instant home insurance quotes for your clients — sign up free: ${a.url}`}
                />
                <p className="text-xs text-slate-500">A ready-made graphic with this link and QR code baked in — easy to text or post to social.</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
