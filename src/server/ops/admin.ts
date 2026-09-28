/**
 * Admin-only: create accounts (D-02). Nobody self-registers.
 * `inviteUser` = create org (when needed) + membership + user with a temporary password, enqueue `auth_invite`, log `user_invited`.
 */
import { randomBytes, createHash } from "node:crypto";
import { eq, ilike } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { organizations, users } from "@/db/schema/app";
import { getAuth } from "@/lib/auth/server";
import { inviteContext } from "@/lib/auth/invite-context";
import { type Ctx, Forbidden, isAdmin } from "@/server/shared/authorize";
import { logActivity } from "@/server/shared/activity";
import { enqueue } from "@/server/shared/outbox";
import { now } from "@/server/shared/clock";
import { ROLES } from "@/db/enums";

export const InviteUserInput = z.object({
  email: z.email().transform((s) => s.trim().toLowerCase()),
  name: z.string().trim().min(2).max(80),
  role: z.enum(ROLES).default("client_owner"),
  /** Existing app org id to attach to; omit to create one named `orgName`. Agents/admins always join the agency. */
  orgId: z.uuid().optional(),
  orgName: z.string().trim().min(1).max(120).optional(),
  country: z.string().trim().length(2).optional(),
  /** Seed/tests may pin the password; otherwise a random 24-char temp password is generated. */
  password: z.string().min(8).optional(),
  at: z.date().optional(),
});
export type InviteUserInput = z.input<typeof InviteUserInput>;

export type InvitedUser = { userId: string; orgId: string; email: string; tempPassword: string; inviteToken: string };

export async function inviteUser(ctx: Ctx | null, raw: InviteUserInput): Promise<InvitedUser> {
  if (ctx && !isAdmin(ctx)) throw new Forbidden("admin only");
  const input = InviteUserInput.parse(raw);
  const db = await getDb();
  const auth = await getAuth();
  const at = input.at ?? now();
  const tempPassword = input.password ?? randomBytes(18).toString("base64url");

  let orgId = input.orgId;
  const isOpsRole = input.role === "admin" || input.role === "agent";
  if (isOpsRole) {
    const [agency] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.type, "agency")).limit(1);
    if (!agency) throw new Error("agency organization missing — seed it first");
    orgId = agency.id;
  } else if (!orgId && input.orgName) {
    const [existing] = await db.select({ id: organizations.id }).from(organizations).where(ilike(organizations.name, input.orgName)).limit(1);
    if (existing) orgId = existing.id;
  }
  const newOrg = !orgId ? { name: input.orgName ?? input.email.split("@")[1], type: "client" as const, country: input.country ?? null } : undefined;

  await inviteContext.run({ role: input.role, orgId, newOrg, at }, async () => {
    await auth.api.signUpEmail({ body: { email: input.email, name: input.name, password: tempPassword } });
  });
  const [u] = await db.select().from(users).where(eq(users.email, input.email)).limit(1);
  if (!u) throw new Error("user row missing after sign-up");

  const inviteToken = randomBytes(24).toString("base64url");
  const expires = new Date(at.getTime() + 7 * 86_400_000);
  await db.update(users).set({ inviteTokenHash: createHash("sha256").update(inviteToken).digest("hex"), inviteExpiresAt: expires, updatedAt: at }).where(eq(users.id, u.id));

  await db.transaction(async (tx) => {
    await logActivity(tx, { orgId: u.orgId, entityType: "organization", entityId: u.orgId, type: "user_invited", actorId: ctx?.userId ?? null, actorName: ctx?.name ?? "System", visibility: "internal", at, payload: { email: input.email, name: input.name, role: input.role } });
    await enqueue({
      userId: u.id, toEmail: u.email, template: "auth_invite", subject: "You've been invited to Influensia",
      payload: { name: input.name, url: `${(process.env.APP_URL ?? process.env.BETTER_AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "")}/invite/${inviteToken}`, path: `/invite/${inviteToken}`, expiresAt: expires.toISOString() },
      idempotencyKey: `auth_invite:${u.id}:${at.toISOString()}`, at,
    }, tx);
  });
  return { userId: u.id, orgId: u.orgId, email: u.email, tempPassword, inviteToken };
}
