import Link from "next/link";

/**
 * A detail/deeper page's way back to its logical parent list — an explicit
 * href rather than router.back()/browser history, since a page can equally
 * be reached by a bookmark or a direct link (e.g. from an email) where
 * history has nothing useful to go back to. Matches the ad hoc "← Label"
 * pattern this app already used in a couple of places before this existed.
 */
export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="inline-block text-xs text-slate-500 hover:underline">
      ← {label}
    </Link>
  );
}
