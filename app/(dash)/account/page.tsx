import { createServerSupabase } from "@/lib/supabase/server";
import { ChangePasswordForm } from "./ChangePasswordForm";

export default async function AccountPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="max-w-md space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-[#003049]">My account</h1>
        <div className="mb-2 mt-2 h-[3px] w-16 bg-[#F0FF00]" />
        <p className="text-sm text-slate-500">{user?.email}</p>
      </div>

      <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="font-medium text-[#003049]">Change password</h2>
        <p className="text-xs text-slate-500">
          You&apos;re already signed in, so this changes your password right away — no email link needed.
        </p>
        <ChangePasswordForm email={user?.email ?? ""} />
      </section>
    </div>
  );
}
