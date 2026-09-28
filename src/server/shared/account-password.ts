/**
 * QA-09 / QA-26 — password lifecycle without an admin in the loop:
 * - Forgot password → Better Auth `requestPasswordReset` (token in `verification`), our `sendResetPassword` hook writes an
 *   `auth_password_reset` outbox row (local mode: drained to .data/outbox.log) with an absolute `/reset-password?token=…` link.
 * - Reset page → Better Auth `resetPassword` (token consumed, sessions revoked), then `passwordSetAt` is stamped.
 * - Invite link `/invite/[token]` → our own token (sha256 in `users.invite_token_hash`, 7 days) → set your password.
 * The same message is returned whether or not an account exists (no enumeration).
 */
import { createHash } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { getDb, type DbOrTx } from "@/db";
import { users } from "@/db/schema/app";
import { getAuth } from "@/lib/auth/server";
import { logActivity } from "./activity";
import { enqueue } from "./outbox";
import { now } from "./clock";

export const INVITE_TTL_MS = 7 * 86_400_000;
export const RESET_TTL_SECONDS = 60 * 60;
const sha = (t: string) => createHash("sha256").update(t).digest("hex");
export const appBaseUrl = () => (process.env.APP_URL ?? process.env.BETTER_AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");

/** Called from the Better Auth `sendResetPassword` hook. Deactivated users get nothing (same response to the caller). */
export async function enqueuePasswordResetEmail(user: { id: string; email: string; name: string }, token: string) {
  const db = await getDb();
  const [u] = await db.select({ id: users.id, deactivatedAt: users.deactivatedAt }).from(users).where(eq(users.id, user.id)).limit(1);
  if (!u || u.deactivatedAt) return;
  const at = now();
  await enqueue({
    userId: user.id, toEmail: user.email, template: "auth_password_reset", subject: "Reset your Influensia password",
    payload: { name: user.name, url: `${appBaseUrl()}/reset-password?token=${encodeURIComponent(token)}`, expiresInMinutes: RESET_TTL_SECONDS / 60 },
    idempotencyKey: `auth_password_reset:${user.id}:${sha(token).slice(0, 16)}`, at,
  });
}

export async function requestPasswordReset(email: string): Promise<void> {
  const auth = await getAuth();
  try {
    await auth.api.requestPasswordReset({ body: { email: email.trim().toLowerCase() } });
  } catch (e) {
    console.error("[password-reset]", e); // never tell the visitor whether the address exists
  }
}

export type SetPasswordResult = { ok: true; email: string } | { ok: false; error: "E_TOKEN_INVALID" | "E_TOKEN_EXPIRED" };

export async function resetPasswordWithToken(token: string, newPassword: string): Promise<SetPasswordResult> {
  const auth = await getAuth();
  try {
    await auth.api.resetPassword({ body: { token, newPassword } });
  } catch {
    return { ok: false, error: "E_TOKEN_INVALID" };
  }
  return { ok: true, email: "" };
}

/** Stamps passwordSetAt + clears the invite token (Better Auth `onPasswordReset` hook and the invite page). */
export async function markPasswordSetById(db: DbOrTx, userId: string, how: "reset" | "invite") {
  const at = now();
  const [u] = await db.select({ orgId: users.orgId, name: users.name }).from(users).where(eq(users.id, userId)).limit(1);
  if (!u) return;
  await db.update(users).set({ passwordSetAt: at, inviteTokenHash: null, inviteExpiresAt: null, updatedAt: at }).where(eq(users.id, userId));
  await logActivity(db, { orgId: u.orgId, entityType: "organization", entityId: u.orgId, type: "profile_updated", actorId: userId, actorName: u.name, visibility: "internal", at, payload: { userId, passwordChanged: true, via: how, text: how === "invite" ? `${u.name} set their password (invitation)` : `${u.name} reset their password` } });
}

/** Invite page: who is this token for? */
export async function inviteLookup(token: string): Promise<{ ok: true; name: string; email: string } | { ok: false; error: "E_TOKEN_INVALID" | "E_TOKEN_EXPIRED" }> {
  if (!token || token.length < 16 || token.length > 200) return { ok: false, error: "E_TOKEN_INVALID" };
  const db = await getDb();
  const [u] = await db.select({ name: users.name, email: users.email, expires: users.inviteExpiresAt, deactivatedAt: users.deactivatedAt }).from(users).where(eq(users.inviteTokenHash, sha(token))).limit(1);
  if (!u || u.deactivatedAt) return { ok: false, error: "E_TOKEN_INVALID" };
  if (!u.expires || u.expires.getTime() < now().getTime()) return { ok: false, error: "E_TOKEN_EXPIRED" };
  return { ok: true, name: u.name, email: u.email };
}

/** Invite page submit: set the password through Better Auth's own hashing, consume the token. */
export async function acceptInvite(token: string, newPassword: string): Promise<SetPasswordResult> {
  const db = await getDb();
  const [u] = await db.select({ id: users.id, email: users.email }).from(users)
    .where(and(eq(users.inviteTokenHash, sha(token)), gt(users.inviteExpiresAt, now()), isNull(users.deactivatedAt))).limit(1);
  if (!u) return { ok: false, error: "E_TOKEN_INVALID" };
  const auth = await getAuth();
  const ctx = await auth.$context;
  const hash = await ctx.password.hash(newPassword);
  const account = await ctx.internalAdapter.findCredentialAccount(u.id);
  if (account) await ctx.internalAdapter.updatePassword(u.id, hash);
  else await ctx.internalAdapter.createAccount({ userId: u.id, providerId: "credential", accountId: u.id, password: hash });
  await ctx.internalAdapter.deleteUserSessions(u.id);
  await markPasswordSetById(db, u.id, "invite");
  return { ok: true, email: u.email };
}
