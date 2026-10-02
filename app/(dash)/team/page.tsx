import { redirect } from "next/navigation";
import { createServerSupabase, createServiceSupabase } from "@/lib/supabase/server";
import { listTeam } from "@/lib/team/team";
import { InviteForm } from "./InviteForm";
import { MemberControls } from "./MemberControls";

export const metadata = { title: "Team" };

export default async function TeamPage() {
  const session = await createServerSupabase();
  const {
    data: { user },
  } = await session.auth.getUser();
  if (!user) redirect("/login");

  const { data: me } = await session.from("profiles").select("agency_id, role, active").eq("id", user.id).maybeSingle();
  if (!me || !me.active || me.role !== "admin") redirect("/properties");

  const team = await listTeam(createServiceSupabase(), me.agency_id);

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-[#003049]">Team</h1>
        <p className="text-sm text-slate-600">Everyone here signs in with their own email and password.</p>
      </div>

      <InviteForm />

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2.5">Name</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5">Manage</th>
            </tr>
          </thead>
          <tbody>
            {team.map((m) => (
              <tr key={m.id} className="border-b border-slate-100 align-top last:border-b-0">
                <td className="px-4 py-3">
                  <div className="font-medium text-slate-900">
                    {m.fullName ?? m.email}
                    {m.id === user.id && <span className="ml-2 text-xs font-normal text-slate-500">(you)</span>}
                  </div>
                  <div className="text-xs text-slate-500">{m.email}</div>
                </td>
                <td className="px-4 py-3 text-xs">
                  {!m.active ? (
                    <span className="rounded bg-slate-100 px-2 py-0.5 text-slate-600">Deactivated</span>
                  ) : m.invitePending ? (
                    <span className="rounded bg-amber-50 px-2 py-0.5 text-amber-800">Invite pending</span>
                  ) : (
                    <span className="rounded bg-green-50 px-2 py-0.5 text-green-800">Active</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <MemberControls memberId={m.id} role={m.role} active={m.active} invitePending={m.invitePending} isSelf={m.id === user.id} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
