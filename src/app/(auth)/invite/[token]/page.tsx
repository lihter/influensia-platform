import Link from "next/link";
import { inviteLookup } from "@/server/shared/account-password";
import { SetPasswordForm } from "../../set-password-form";
import { acceptInviteAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Set your password" };

/** QA-09: `/invite/[token]` from the invitation email / admin dialog → "set your password" (7-day token). */
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const who = await inviteLookup(token);
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold">{who.ok ? `Welcome, ${who.name}` : "Invitation link not valid"}</h1>
        <p className="mt-1 text-sm text-ink-2">{who.ok ? <>Set a password for <span className="font-medium text-foreground">{who.email}</span> to start using Influensia.</> : who.error === "E_TOKEN_EXPIRED" ? "This invitation has expired." : "This link was already used or is incomplete."}</p>
      </div>
      {who.ok ? (
        <SetPasswordForm email={who.email} submitLabel="Set password" submit={async (password) => { "use server"; return acceptInviteAction({ token, password }); }} />
      ) : (
        <p className="rounded-lg border border-border bg-surface-sunken px-3 py-2 text-sm text-ink-2" data-testid="invite-invalid">Ask your Influensia contact for a new invitation, or <Link href="/forgot-password" className="link">reset your password</Link> if you already have an account.</p>
      )}
      <Link href="/login" className="link text-center text-sm">Back to sign in</Link>
    </div>
  );
}
