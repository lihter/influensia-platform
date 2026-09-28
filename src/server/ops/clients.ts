/**
 * Clients admin (SPEC F-26): client organisations, their users, settings, lines/orders per org, and the org activity feed.
 * Reads are open to every ops role; every mutation is admin-only (SPEC §1.4) and logs an `organization` activity event
 * in the same transaction. Invites go through the foundation's `inviteUser()`.
 */
import { randomBytes, createHash } from "node:crypto";
import { cookies, headers } from "next/headers";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, type DbOrTx } from "@/db";
import { organizations, users, orders, activityEvents } from "@/db/schema/app";
import { member, session as authSession } from "@/db/schema/auth";
import { COMMERCIAL_MODES, PRICING_DISPLAYS, INCOTERMS, type ActivityType, type CommercialMode, type PricingDisplay, type LineState, type LineException, type Role } from "@/db/enums";
import { type Ctx, isOps, isAdmin, Forbidden, NotFound } from "@/server/shared/authorize";
import { loadLineContexts } from "@/server/shared/line-context";
import { listActivity, logActivity } from "@/server/shared/activity";
import { enqueue } from "@/server/shared/outbox";
import { now } from "@/server/shared/clock";
import { isStale } from "@/server/shared/derived";
import { inviteUser } from "./admin";

/* ────────── pure helpers (unit-tested in tests/unit/clients.test.ts) ────────── */

export const LANGUAGES = ["en", "pl", "hr", "ro", "de"] as const;
export type Language = (typeof LANGUAGES)[number];

/** ISO-3166 alpha-2, upper-cased. */
export const countryCode = z.string().trim().length(2, "Use a 2-letter country code").transform((s) => s.toUpperCase());

export const ClientSettingsInput = z.object({
  name: z.string().trim().min(1).max(120),
  country: countryCode.nullable().optional(),
  vatId: z.string().trim().max(32).nullable().optional().transform((s) => (s ? s : null)),
  commercialMode: z.enum(COMMERCIAL_MODES),
  pricingDisplay: z.enum(PRICING_DISPLAYS),
  defaultIncoterm: z.enum(INCOTERMS),
  depositPct: z.coerce.number().int().min(0).max(100),
  language: z.enum(LANGUAGES),
  timezone: z.string().trim().min(1).max(64),
});
export type ClientSettingsInput = z.input<typeof ClientSettingsInput>;

/** "+ Client": org + first client_owner in one form (SPEC F-26 "New client"). */
export const CreateClientInput = z.object({
  orgName: z.string().trim().min(1, "Required").max(120),
  country: countryCode,
  vatId: z.string().trim().max(32).optional().transform((s) => (s ? s : null)),
  userName: z.string().trim().min(2, "At least 2 characters").max(80),
  email: z.string().trim().pipe(z.email("Enter a valid email")).transform((s) => s.toLowerCase()),
  commercialMode: z.enum(COMMERCIAL_MODES).default("agency_passthrough"),
  pricingDisplay: z.enum(PRICING_DISPLAYS).default("factory_plus_fee"),
  defaultIncoterm: z.enum(INCOTERMS).default("FOB"),
  language: z.enum(LANGUAGES).default("en"),
});
export type CreateClientInput = z.input<typeof CreateClientInput>;

export const AddClientUserInput = z.object({
  orgId: z.uuid(),
  name: z.string().trim().min(2, "At least 2 characters").max(80),
  email: z.string().trim().pipe(z.email("Enter a valid email")).transform((s) => s.toLowerCase()),
});
export type AddClientUserInput = z.input<typeof AddClientUserInput>;

export type UserStatus = "invited" | "active" | "deactivated";

/** Users card status (SPEC F-26): deactivated wins; a user who never set a password is still "Invited". */
export function userStatus(u: { deactivatedAt: Date | null; passwordSetAt: Date | null; inviteExpiresAt?: Date | null }): UserStatus {
  if (u.deactivatedAt) return "deactivated";
  if (!u.passwordSetAt) return "invited";
  return "active";
}

/** "Active lines" (AC-CLI-01): every non-draft line that is not delivered/completed/cancelled — lines inside an order count too. */
export const isOpenState = (state: LineState, exception: LineException | null) => state !== "completed" && state !== "delivered" && exception !== "cancelled";

/**
 * Activity types this feature needs that are not (yet) in `ACTIVITY_TYPES` (SPEC 3.6 only lists `user_invited` for
 * organisations). There is no DB check constraint on `activity_events.type`, the events are internal-only and rendered
 * through `payload.text`, so they are written as-is. Foundation ask: add these values to `src/db/enums.ts`.
 */
export const ADMIN_EVENTS = {
  orgUpdated: "org_updated",
  userDeactivated: "user_deactivated",
  userReactivated: "user_reactivated",
  inviteResent: "user_invited",
} as const;
const adminEvent = (t: (typeof ADMIN_EVENTS)[keyof typeof ADMIN_EVENTS]) => t as unknown as ActivityType;

/* ────────── read models ────────── */

export type ClientOrgRow = {
  id: string;
  name: string;
  country: string | null;
  vatId: string | null;
  users: number;
  commercialMode: CommercialMode;
  pricingDisplay: PricingDisplay;
  language: string;
  currencyDisplay: string;
  defaultIncoterm: string;
  depositPct: number;
  timezone: string;
  openLines: number;
  openOrders: number;
  lastActivityAt: string | null;
  partnerName: string | null;
  createdAt: string;
};

export type ClientUserRow = {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: UserStatus;
  lastSeenAt: string | null;
  inviteExpiresAt: string | null;
  createdAt: string;
};

export type ClientLineRow = {
  id: string;
  ref: string;
  requestRef: string;
  name: string;
  qty: number | null;
  unit: string;
  state: LineState;
  exception: LineException | null;
  stale: boolean;
  agentName: string | null;
  lastChangeAt: string;
  href: string;
};

export type ClientOrderRow = {
  id: string;
  ref: string;
  state: LineState;
  exception: LineException | null;
  stale: boolean;
  totalMinor: number;
  currency: string;
  confirmedAt: string | null;
  lastChangeAt: string;
  href: string;
};

export type ClientActivityRow = { id: string; type: string; at: string; actorName: string | null; text: string; payload: Record<string, unknown> };

export type ClientDetail = {
  org: ClientOrgRow;
  users: ClientUserRow[];
  lines: ClientLineRow[];
  orders: ClientOrderRow[];
  activity: ClientActivityRow[];
};

function orgRow(o: typeof organizations.$inferSelect, extra: { users: number; openLines: number; openOrders: number; lastActivityAt: Date | null; partnerName: string | null }): ClientOrgRow {
  return {
    id: o.id, name: o.name, country: o.country, vatId: o.vatId, users: extra.users,
    commercialMode: o.commercialMode, pricingDisplay: o.pricingDisplay, language: o.language, currencyDisplay: o.currencyDisplay,
    defaultIncoterm: o.defaultIncoterm, depositPct: o.depositPct, timezone: o.timezone,
    openLines: extra.openLines, openOrders: extra.openOrders, lastActivityAt: extra.lastActivityAt?.toISOString() ?? null,
    partnerName: extra.partnerName, createdAt: o.createdAt.toISOString(),
  };
}

async function countsByOrg(db: DbOrTx, orgIds: string[]) {
  const userCount = new Map<string, number>(), lines = new Map<string, number>(), ords = new Map<string, number>(), last = new Map<string, Date>();
  if (!orgIds.length) return { users: userCount, lines, ords, last };
  const u = await db.select({ orgId: users.orgId, n: sql<number>`count(*)::int` }).from(users).where(and(inArray(users.orgId, orgIds), isNull(users.deactivatedAt))).groupBy(users.orgId);
  for (const r of u) userCount.set(r.orgId, r.n);
  const lcs = await loadLineContexts(db, {});
  for (const lc of lcs) {
    if (!orgIds.includes(lc.orgId)) continue;
    const state = lc.order ? lc.order.state : lc.state, exception = lc.order ? lc.order.exception : lc.exception;
    if (isOpenState(state, exception)) lines.set(lc.orgId, (lines.get(lc.orgId) ?? 0) + 1);
  }
  const o = await db.select({ orgId: orders.orgId, n: sql<number>`count(*)::int` }).from(orders).where(and(inArray(orders.orgId, orgIds), isNull(orders.deletedAt))).groupBy(orders.orgId);
  for (const r of o) ords.set(r.orgId, r.n);
  const a = await db.select({ orgId: activityEvents.orgId, at: sql<Date>`max(${activityEvents.createdAt})` }).from(activityEvents).where(inArray(activityEvents.orgId, orgIds)).groupBy(activityEvents.orgId);
  for (const r of a) last.set(r.orgId, new Date(r.at));
  return { users: userCount, lines, ords, last };
}

export async function listClients(ctx: Ctx): Promise<ClientOrgRow[]> {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const db = await getDb();
  const orgs = await db.select().from(organizations).where(and(eq(organizations.type, "client"), isNull(organizations.deletedAt))).orderBy(organizations.name);
  const c = await countsByOrg(db, orgs.map((o) => o.id));
  const partnerIds = orgs.map((o) => o.partnerOrgId).filter((x): x is string => !!x);
  const partners = partnerIds.length ? await db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(inArray(organizations.id, partnerIds)) : [];
  const partnerName = new Map(partners.map((p) => [p.id, p.name]));
  return orgs.map((o) => orgRow(o, { users: c.users.get(o.id) ?? 0, openLines: c.lines.get(o.id) ?? 0, openOrders: c.ords.get(o.id) ?? 0, lastActivityAt: c.last.get(o.id) ?? null, partnerName: o.partnerOrgId ? partnerName.get(o.partnerOrgId) ?? null : null }));
}

async function clientOrg(db: DbOrTx, orgId: string) {
  const [o] = await db.select().from(organizations).where(and(eq(organizations.id, orgId), eq(organizations.type, "client"), isNull(organizations.deletedAt))).limit(1);
  if (!o) throw new NotFound("client not found");
  return o;
}

/** One line of text for the org feed; admin events pre-render into `payload.text`. */
function activityText(type: string, p: Record<string, unknown>): string {
  if (typeof p.text === "string" && p.text) return p.text;
  if (type === "user_invited") return p.resend ? `Invite resent to ${p.email ?? ""}`.trim() : `${p.name ?? p.email ?? "User"} invited (${p.role ?? "client_owner"})`;
  return type.replace(/_/g, " ");
}

export async function getClient(ctx: Ctx, orgId: string): Promise<ClientDetail> {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const db = await getDb();
  const o = await clientOrg(db, orgId);
  const c = await countsByOrg(db, [o.id]);
  const partner = o.partnerOrgId ? (await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, o.partnerOrgId)).limit(1))[0]?.name ?? null : null;

  const urows = await db
    .select({ id: users.id, name: users.name, email: users.email, lastSeenAt: users.lastSeenAt, deactivatedAt: users.deactivatedAt, passwordSetAt: users.passwordSetAt, inviteExpiresAt: users.inviteExpiresAt, createdAt: users.createdAt, role: member.role })
    .from(users).leftJoin(member, eq(member.userId, users.id)).where(eq(users.orgId, o.id)).orderBy(users.createdAt);

  const lcs = await loadLineContexts(db, { orgId: o.id, includeCancelled: true });
  const lines: ClientLineRow[] = lcs.map((lc) => ({
    id: lc.id, ref: lc.ref, requestRef: lc.requestRef, name: lc.name, qty: lc.qty, unit: lc.unit, state: lc.state, exception: lc.exception, stale: lc.stale,
    agentName: lc.agentName, lastChangeAt: lc.lastStateChangeAt.toISOString(), href: `/ops/lines/${lc.ref}`,
  }));
  const orows = await db.select().from(orders).where(and(eq(orders.orgId, o.id), isNull(orders.deletedAt))).orderBy(desc(orders.createdAt));
  const ordersOut: ClientOrderRow[] = orows.map((r) => ({
    id: r.id, ref: r.ref, state: r.state, exception: r.exception, stale: isStale({ state: r.state, exception: r.exception, lastStateChangeAt: r.lastStateChangeAt }),
    totalMinor: r.totalMinor, currency: r.currency, confirmedAt: r.confirmedAt?.toISOString() ?? null, lastChangeAt: r.lastStateChangeAt.toISOString(), href: `/ops/orders/${r.ref}`,
  }));
  const events = await listActivity(db, { entityType: "organization", entityId: o.id, limit: 100 });

  return {
    org: orgRow(o, { users: c.users.get(o.id) ?? 0, openLines: c.lines.get(o.id) ?? 0, openOrders: c.ords.get(o.id) ?? 0, lastActivityAt: c.last.get(o.id) ?? null, partnerName: partner }),
    users: urows.map((u) => ({
      id: u.id, name: u.name, email: u.email, role: (u.role ?? "client_owner") as Role, status: userStatus(u),
      lastSeenAt: u.lastSeenAt?.toISOString() ?? null, inviteExpiresAt: u.inviteExpiresAt?.toISOString() ?? null, createdAt: u.createdAt.toISOString(),
    })),
    lines,
    orders: ordersOut,
    activity: events.map((e) => ({ id: e.id, type: e.type, at: e.createdAt.toISOString(), actorName: e.actorName, text: activityText(e.type, e.payload), payload: e.payload })),
  };
}

/* ────────── mutations (admin only) ────────── */

const SESSION_COOKIES = ["__Secure-better-auth.session_token", "better-auth.session_token"];

/**
 * WORKAROUND (foundation ask): `inviteUser()` → `auth.api.signUpEmail` auto-signs-in the NEW user, and the `nextCookies`
 * plugin writes that session cookie onto the admin's response inside a server action — the admin would land on the client's
 * door (404 on /ops) after every invite. Until `emailAndPassword.autoSignIn: false` lands in src/lib/auth/server.ts we keep
 * the caller's cookie: read it before, re-set it after (last `cookies().set` wins), and drop the invitee's stray session rows.
 */
async function keepCallerSession<T extends { userId: string }>(db: DbOrTx, fn: () => Promise<T>): Promise<T> {
  let saved: { name: string; value: string } | null = null;
  try {
    const raw = (await headers()).get("cookie") ?? "";
    for (const part of raw.split(";")) {
      const [k, ...v] = part.trim().split("=");
      if (SESSION_COOKIES.includes(k)) { saved = { name: k, value: decodeURIComponent(v.join("=")) }; break; }
    }
  } catch { /* outside a request scope (seed/tests) */ }
  const r = await fn();
  if (saved) {
    try {
      const c = await cookies();
      c.set(saved.name, saved.value, { httpOnly: true, sameSite: "lax", path: "/", secure: saved.name.startsWith("__Secure-"), maxAge: 60 * 60 * 24 * 30 });
    } catch { /* not in a mutable cookie scope */ }
    await db.delete(authSession).where(eq(authSession.userId, r.userId));
  }
  return r;
}

export async function updateClientSettings(ctx: Ctx, orgId: string, raw: ClientSettingsInput): Promise<{ changed: string[] }> {
  if (!isAdmin(ctx)) throw new Forbidden("admin only");
  const input = ClientSettingsInput.parse(raw);
  const db = await getDb();
  const o = await clientOrg(db, orgId);
  const at = now();
  const patch = {
    name: input.name, country: input.country ?? o.country, vatId: input.vatId === undefined ? o.vatId : input.vatId, commercialMode: input.commercialMode, pricingDisplay: input.pricingDisplay,
    defaultIncoterm: input.defaultIncoterm, depositPct: input.depositPct, language: input.language, timezone: input.timezone,
  };
  const changed = (Object.keys(patch) as (keyof typeof patch)[]).filter((k) => patch[k] !== o[k]);
  if (!changed.length) return { changed };
  await db.transaction(async (tx) => {
    await tx.update(organizations).set({ ...patch, updatedAt: at }).where(eq(organizations.id, o.id));
    const summary = changed.map((k) => `${k}: ${String(o[k] ?? "—")} → ${String(patch[k] ?? "—")}`).join(", ");
    await logActivity(tx, { orgId: o.id, entityType: "organization", entityId: o.id, type: adminEvent(ADMIN_EVENTS.orgUpdated), actorId: ctx.userId, actorName: ctx.name, visibility: "internal", at, payload: { changed, text: `Settings updated — ${summary}` } });
  });
  return { changed };
}

/** The foundation's `inviteUser` with the session workaround above (used by `inviteUserAction`). */
export async function inviteUserKeepingSession(ctx: Ctx, raw: Parameters<typeof inviteUser>[1]) {
  if (!isAdmin(ctx)) throw new Forbidden("admin only");
  const db = await getDb();
  return keepCallerSession(db, () => inviteUser(ctx, raw));
}

export async function createClient(ctx: Ctx, raw: CreateClientInput) {
  if (!isAdmin(ctx)) throw new Forbidden("admin only");
  const input = CreateClientInput.parse(raw);
  const db = await getDb();
  const [dup] = await db.select({ id: organizations.id }).from(organizations).where(sql`lower(${organizations.name}) = lower(${input.orgName})`).limit(1);
  if (dup) throw new z.ZodError([{ code: "custom", path: ["orgName"], message: "A client with this name already exists — open it and add the user there.", input: input.orgName }]);
  const [dupUser] = await db.select({ id: users.id }).from(users).where(eq(users.email, input.email)).limit(1);
  if (dupUser) throw new z.ZodError([{ code: "custom", path: ["email"], message: "A user with this email already exists.", input: input.email }]);
  const at = now();
  const r = await keepCallerSession(db, () => inviteUser(ctx, { email: input.email, name: input.userName, role: "client_owner", orgName: input.orgName, country: input.country, at }));
  await db.transaction(async (tx) => {
    await tx.update(organizations).set({ vatId: input.vatId, commercialMode: input.commercialMode, pricingDisplay: input.pricingDisplay, defaultIncoterm: input.defaultIncoterm, language: input.language, updatedAt: at }).where(eq(organizations.id, r.orgId));
    await logActivity(tx, { orgId: r.orgId, entityType: "organization", entityId: r.orgId, type: adminEvent(ADMIN_EVENTS.orgUpdated), actorId: ctx.userId, actorName: ctx.name, visibility: "internal", at, payload: { created: true, text: `Client created — ${input.orgName} (${input.country}), ${input.commercialMode} · ${input.pricingDisplay} · ${input.defaultIncoterm}` } });
  });
  return { orgId: r.orgId, userId: r.userId, email: r.email, tempPassword: r.tempPassword, inviteToken: r.inviteToken };
}

export async function addClientUser(ctx: Ctx, raw: AddClientUserInput) {
  if (!isAdmin(ctx)) throw new Forbidden("admin only");
  const input = AddClientUserInput.parse(raw);
  const db = await getDb();
  await clientOrg(db, input.orgId);
  const [dupUser] = await db.select({ id: users.id }).from(users).where(eq(users.email, input.email)).limit(1);
  if (dupUser) throw new z.ZodError([{ code: "custom", path: ["email"], message: "A user with this email already exists.", input: input.email }]);
  const r = await keepCallerSession(db, () => inviteUser(ctx, { email: input.email, name: input.name, role: "client_owner", orgId: input.orgId }));
  return { userId: r.userId, email: r.email, tempPassword: r.tempPassword, inviteToken: r.inviteToken };
}

async function clientUser(db: DbOrTx, userId: string) {
  const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!u) throw new NotFound("user not found");
  await clientOrg(db, u.orgId);
  return u;
}

/** F-01: deactivated users cannot sign in (authorize() rejects them) and their sessions are revoked now. */
export async function deactivateUser(ctx: Ctx, userId: string): Promise<void> {
  if (!isAdmin(ctx)) throw new Forbidden("admin only");
  if (userId === ctx.userId) throw new Forbidden("cannot deactivate yourself");
  const db = await getDb();
  const u = await clientUser(db, userId);
  if (u.deactivatedAt) return;
  const at = now();
  await db.transaction(async (tx) => {
    await tx.update(users).set({ deactivatedAt: at, updatedAt: at }).where(eq(users.id, u.id));
    await tx.delete(authSession).where(eq(authSession.userId, u.id));
    await logActivity(tx, { orgId: u.orgId, entityType: "organization", entityId: u.orgId, type: adminEvent(ADMIN_EVENTS.userDeactivated), actorId: ctx.userId, actorName: ctx.name, visibility: "internal", at, payload: { userId: u.id, email: u.email, text: `${u.name} deactivated (${u.email})` } });
  });
}

export async function reactivateUser(ctx: Ctx, userId: string): Promise<void> {
  if (!isAdmin(ctx)) throw new Forbidden("admin only");
  const db = await getDb();
  const u = await clientUser(db, userId);
  if (!u.deactivatedAt) return;
  const at = now();
  await db.transaction(async (tx) => {
    await tx.update(users).set({ deactivatedAt: null, updatedAt: at }).where(eq(users.id, u.id));
    await logActivity(tx, { orgId: u.orgId, entityType: "organization", entityId: u.orgId, type: adminEvent(ADMIN_EVENTS.userReactivated), actorId: ctx.userId, actorName: ctx.name, visibility: "internal", at, payload: { userId: u.id, email: u.email, text: `${u.name} reactivated (${u.email})` } });
  });
}

/** F-01: "Resend invite" regenerates the 7-day token and writes a new `auth_invite` outbox row (N-01). */
export async function resendInvite(ctx: Ctx, userId: string): Promise<{ inviteToken: string; expiresAt: string }> {
  if (!isAdmin(ctx)) throw new Forbidden("admin only");
  const db = await getDb();
  const u = await clientUser(db, userId);
  if (u.deactivatedAt) throw new Forbidden("user is deactivated");
  const at = now();
  const inviteToken = randomBytes(24).toString("base64url");
  const expires = new Date(at.getTime() + 7 * 86_400_000);
  await db.transaction(async (tx) => {
    await tx.update(users).set({ inviteTokenHash: createHash("sha256").update(inviteToken).digest("hex"), inviteExpiresAt: expires, updatedAt: at }).where(eq(users.id, u.id));
    await logActivity(tx, { orgId: u.orgId, entityType: "organization", entityId: u.orgId, type: adminEvent(ADMIN_EVENTS.inviteResent), actorId: ctx.userId, actorName: ctx.name, visibility: "internal", at, payload: { email: u.email, name: u.name, role: "client_owner", resend: true } });
    await enqueue({
      userId: u.id, toEmail: u.email, template: "auth_invite", subject: "You've been invited to Influensia",
      payload: { name: u.name, url: `/invite/${inviteToken}`, expiresAt: expires.toISOString(), resend: true },
      idempotencyKey: `auth_invite:${u.id}:${at.toISOString()}`, at,
    }, tx);
  });
  return { inviteToken, expiresAt: expires.toISOString() };
}
