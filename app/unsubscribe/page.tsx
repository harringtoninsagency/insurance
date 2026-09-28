import type { Metadata } from "next";
import Image from "next/image";
import brightwayLogo from "@/assets/branding/brightway-harrington-horizontal-deep-blue.png";
import { UnsubscribeForm } from "./UnsubscribeForm";

export const metadata: Metadata = {
  title: "Unsubscribe | Brightway Insurance",
  robots: { index: false, follow: false },
};

export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const t = (await searchParams).t;
  const token = typeof t === "string" ? t : "";

  return (
    <div className="mx-auto max-w-xl px-5 py-10">
      <Image src={brightwayLogo} alt="Brightway Insurance | The Harrington Agency" className="h-auto w-64 max-w-full" priority />
      <div className="mb-8 mt-4 h-[3px] w-full bg-[#F0FF00]" />
      <h1 className="text-xl font-semibold text-[#003049]">Unsubscribe</h1>
      {token ? (
        <div className="mt-4 space-y-4 text-sm text-slate-700">
          <p>Confirm below and we&apos;ll stop emailing you.</p>
          <UnsubscribeForm token={token} />
        </div>
      ) : (
        <p className="mt-4 text-sm text-slate-700">
          This link is missing its unsubscribe code. Use the link in the email, or contact us at
          harringtonagency@brightway.com or 727-789-2200 and we&apos;ll remove you.
        </p>
      )}
    </div>
  );
}
