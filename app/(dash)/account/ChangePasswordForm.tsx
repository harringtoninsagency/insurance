"use client";

import { useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase/client";

const inputClass = "w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-[#003049] focus:outline-none";

export function ChangePasswordForm({ email }: { email: string }) {
  const supabase = createBrowserSupabase();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (newPassword.length < 10) {
      setError("New password must be at least 10 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("New passwords don't match.");
      return;
    }

    setLoading(true);

    // Re-verify the current password before changing anything -- an active
    // session alone shouldn't be enough to change the password on a shared
    // or unlocked computer.
    const { error: verifyError } = await supabase.auth.signInWithPassword({ email, password: currentPassword });
    if (verifyError) {
      setLoading(false);
      setError("Current password is incorrect.");
      return;
    }

    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
    setLoading(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }

    setSuccess(true);
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {success && <p className="rounded bg-green-50 px-3 py-2 text-sm text-green-800">Password updated.</p>}

      <div className="space-y-1">
        <label htmlFor="current_password" className="text-sm font-medium text-[#003049]">
          Current password
        </label>
        <input
          id="current_password"
          type="password"
          required
          autoComplete="current-password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          className={inputClass}
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="new_password" className="text-sm font-medium text-[#003049]">
          New password
        </label>
        <input
          id="new_password"
          type="password"
          required
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          className={inputClass}
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="confirm_password" className="text-sm font-medium text-[#003049]">
          Confirm new password
        </label>
        <input
          id="confirm_password"
          type="password"
          required
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          className={inputClass}
        />
      </div>

      <button
        type="submit"
        disabled={loading}
        className="rounded bg-[#003049] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
      >
        {loading ? "Saving..." : "Change password"}
      </button>
    </form>
  );
}
