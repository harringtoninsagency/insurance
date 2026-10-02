import { NewQuoteForm } from "./NewQuoteForm";

export const metadata = { title: "Run a quote" };

export default function NewQuotePage() {
  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-semibold text-[#003049]">Run a property insurance quote</h1>
      <div className="mb-2 mt-2 h-[3px] w-16 bg-[#F0FF00]" />
      <p className="mb-6 text-sm text-slate-500">
        Enter an address and we&apos;ll match it to county records and queue it for carrier quotes. A quote run starts right
        away, so results usually appear on the property page within a few minutes; if it can&apos;t start, the hourly run
        picks it up.
      </p>
      <div className="rounded-lg border border-slate-200 bg-white p-6">
        <NewQuoteForm />
      </div>
    </div>
  );
}
