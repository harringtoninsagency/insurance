import QRCode from "qrcode";
import { appBaseUrl } from "@/lib/base-url";
import { CopyLinkButton } from "./CopyLinkButton";

export const metadata = { title: "Share with a partner" };

export default async function SharePage() {
  const signupUrl = `${appBaseUrl()}/partner/signup`;
  // Deep blue instead of pure black to match the brand, but still dark
  // enough for a phone camera to read reliably — plain black-on-white is
  // the safer default for scannability, this is close to it.
  const qrSvg = await QRCode.toString(signupUrl, {
    type: "svg",
    color: { dark: "#003049", light: "#FFFFFF" },
    margin: 1,
    width: 240,
  });

  return (
    <div className="max-w-xl">
      <h1 className="text-xl font-semibold text-[#003049]">Share with a partner</h1>
      <div className="mb-2 mt-2 h-[3px] w-16 bg-[#F0FF00]" />
      <p className="mb-6 text-sm text-slate-500">
        Hand a realtor or mortgage broker this link or QR code — at a showing, closing, or anywhere else — to sign
        up for the partner portal. Once they&apos;re signed in, they can{" "}
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

      <div className="flex flex-col items-center gap-5 rounded-lg border border-slate-200 bg-white p-8 text-center sm:flex-row sm:items-start sm:text-left">
        <div
          className="shrink-0 rounded border border-slate-200 p-2"
          // qrSvg is generated server-side from a URL this app itself built
          // (appBaseUrl() + a fixed path) — no user input ever reaches it.
          dangerouslySetInnerHTML={{ __html: qrSvg }}
        />
        <div className="flex-1 space-y-3">
          <div>
            <div className="text-xs font-medium uppercase text-slate-400">Partner sign-up link</div>
            <div className="mt-1 break-all rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-[#003049]">{signupUrl}</div>
          </div>
          <CopyLinkButton url={signupUrl} />
          <p className="text-xs text-slate-500">Scan the code to open the link directly on a phone.</p>
        </div>
      </div>
    </div>
  );
}
