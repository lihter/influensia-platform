import Link from "next/link";
import { SetPasswordForm } from "../set-password-form";
import { resetPasswordAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Choose a new password" };

/** QA-09: the page the reset email links to (`/reset-password?token=…`). */
export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string; error?: string }> }) {
  const { token, error } = await searchParams;
  const valid = !!token && !error;
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold">Choose a new password</h1>
        <p className="mt-1 text-sm text-ink-2">{valid ? "Pick a password you don't use anywhere else." : "This reset link is not valid any more."}</p>
      </div>
      {valid ? (
        <SetPasswordForm submitLabel="Save password and sign in" submit={async (password) => { "use server"; return resetPasswordAction({ token: token!, password }); }} />
      ) : (
        <p className="rounded-lg border border-border bg-surface-sunken px-3 py-2 text-sm text-ink-2" data-testid="reset-invalid">Reset links work once and expire after an hour. <Link href="/forgot-password" className="link">Ask for a new link</Link>.</p>
      )}
      <Link href="/login" className="link text-center text-sm">Back to sign in</Link>
    </div>
  );
}
