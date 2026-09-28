/**
 * Client account settings (SPEC F-01 `/app/settings`): own name + password, company details read-only, notification
 * preferences stub. Scoped by ctx.orgId; app schema only. Password changes go through the Better Auth client (`changePassword`)
 * and are then acknowledged here (`passwordSetAt`).
 */
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { organizations, users } from "@/db/schema/app";
import { user as authUser, member } from "@/db/schema/auth";
import type { ActivityType } from "@/db/enums";
import { type Ctx, isClient, Forbidden, NotFound } from "@/server/shared/authorize";
import { logActivity } from "@/server/shared/activity";
import { now } from "@/server/shared/clock";
import { ClientAccountDto, ProfileInput, type ClientNotificationPrefDto } from "./dto/settings";

/** Not in ACTIVITY_TYPES yet (see src/server/ops/clients.ts ADMIN_EVENTS); internal-only, rendered via payload.text.
 *  Logged on the organisation (activity_events.entity_id is a uuid; Better Auth user ids are not). */
const EVENT_PROFILE = "profile_updated" as unknown as ActivityType;

export { ProfileInput, PasswordInput } from "./dto/settings";

/** v1 stub (SPEC §6 "v1 has no mute settings at all"): action-needed emails are always on. */
export const NOTIFICATION_PREFS: ClientNotificationPrefDto[] = [
  { key: "action_needed", label: "Action needed", description: "Price ready, sample decision, payment due, artwork, delivery confirmation. These keep your order moving and cannot be turned off.", required: true, enabled: true },
  { key: "progress", label: "Progress updates", description: "Milestone changes, ETA updates and new documents.", required: false, enabled: true },
  { key: "messages", label: "Messages from your contact", description: "Updates and questions posted by your Influensia contact.", required: false, enabled: true },
];

export async function getClientAccount(ctx: Ctx): Promise<ClientAccountDto> {
  if (!isClient(ctx)) throw new Forbidden("clients only");
  const db = await getDb();
  const [me] = await db.select().from(users).where(and(eq(users.id, ctx.userId), eq(users.orgId, ctx.orgId))).limit(1);
  if (!me) throw new NotFound("profile not found");
  const [org] = await db.select().from(organizations).where(eq(organizations.id, ctx.orgId)).limit(1);
  if (!org) throw new NotFound("account not found");
  const mates = await db
    .select({ name: users.name, email: users.email, passwordSetAt: users.passwordSetAt })
    .from(users).innerJoin(member, eq(member.userId, users.id))
    .where(and(eq(users.orgId, ctx.orgId), isNull(users.deactivatedAt)))
    .orderBy(users.name);
  return ClientAccountDto.parse({
    name: me.name,
    email: me.email,
    role: ctx.role === "client_member" ? "client_member" : "client_owner",
    passwordSetAt: me.passwordSetAt?.toISOString() ?? null,
    lastSeenAt: me.lastSeenAt?.toISOString() ?? null,
    company: {
      name: org.name, country: org.country, vatId: org.vatId, language: org.language, currencyDisplay: org.currencyDisplay,
      defaultIncoterm: org.defaultIncoterm, timezone: org.timezone, pricingDisplay: org.pricingDisplay,
    },
    teammates: mates.filter((m) => m.email !== me.email).map((m) => ({ name: m.name, email: m.email, status: m.passwordSetAt ? "active" : "invited" })),
    notifications: NOTIFICATION_PREFS,
  });
}

/** Own name only (SPEC §1.4: client U own name/password). Keeps the Better Auth user row in step. */
export async function updateClientProfile(ctx: Ctx, raw: ProfileInput): Promise<{ name: string }> {
  if (!isClient(ctx)) throw new Forbidden("clients only");
  const input = ProfileInput.parse(raw);
  const db = await getDb();
  const at = now();
  await db.transaction(async (tx) => {
    const [me] = await tx.select({ id: users.id }).from(users).where(and(eq(users.id, ctx.userId), eq(users.orgId, ctx.orgId))).limit(1);
    if (!me) throw new NotFound("profile not found");
    await tx.update(users).set({ name: input.name, updatedAt: at }).where(eq(users.id, me.id));
    await tx.update(authUser).set({ name: input.name }).where(eq(authUser.id, ctx.userId));
    await logActivity(tx, { orgId: ctx.orgId, entityType: "organization", entityId: ctx.orgId, type: EVENT_PROFILE, actorId: ctx.userId, actorName: input.name, visibility: "internal", at, payload: { userId: ctx.userId, from: ctx.name, to: input.name, text: `${ctx.name} renamed themselves to ${input.name}` } });
  });
  return { name: input.name };
}

/** Called after a successful Better Auth `changePassword`: the invite is consumed and the user is no longer "Invited". */
export async function markPasswordSet(ctx: Ctx): Promise<void> {
  if (!isClient(ctx)) throw new Forbidden("clients only");
  const db = await getDb();
  const at = now();
  await db.transaction(async (tx) => {
    await tx.update(users).set({ passwordSetAt: at, inviteTokenHash: null, inviteExpiresAt: null, updatedAt: at }).where(and(eq(users.id, ctx.userId), eq(users.orgId, ctx.orgId)));
    await logActivity(tx, { orgId: ctx.orgId, entityType: "organization", entityId: ctx.orgId, type: EVENT_PROFILE, actorId: ctx.userId, actorName: ctx.name, visibility: "internal", at, payload: { userId: ctx.userId, passwordChanged: true, text: `${ctx.name} changed their password` } });
  });
}
