import { cache } from "react";
import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { getAuth } from "@/lib/auth/server";
import { getDb } from "@/db";
import { member } from "@/db/schema/auth";
import { organizations, users } from "@/db/schema/app";
import type { Role, OrgType } from "@/db/enums";

export type { Role };
export type Ctx = { userId: string; email: string; name: string; orgId: string; authOrgId: string; role: Role; orgType: OrgType };

export class Unauthorized extends Error { status = 401; code = "E_UNAUTHORIZED" as const; }
export class Forbidden extends Error { status = 403; code = "E_FORBIDDEN" as const; }
export class NotFound extends Error { status = 404; code = "E_NOT_FOUND" as const; }

export const CLIENT_ROLES: readonly Role[] = ["client_owner", "client_member"];
export const OPS_ROLES: readonly Role[] = ["admin", "agent"];
export const isOps = (ctx: Ctx) => OPS_ROLES.includes(ctx.role);
export const isClient = (ctx: Ctx) => CLIENT_ROLES.includes(ctx.role);
export const isAdmin = (ctx: Ctx) => ctx.role === "admin";
export const doorFor = (role: Role) => (OPS_ROLES.includes(role) ? "/ops" : "/app");

/**
 * Resolves session → member row → app.organizations; memoised per request with React.cache.
 * Every repository function takes `ctx` first and scopes by ctx.orgId (clients) or asserts isOps (ops).
 */
const resolve = cache(async (): Promise<Ctx | null> => {
  const auth = await getAuth();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  const db = await getDb();
  const [m] = await db.select().from(member).where(eq(member.userId, session.user.id)).limit(1);
  if (!m) throw new Forbidden("no membership");
  const [org] = await db.select().from(organizations).where(eq(organizations.authOrgId, m.organizationId)).limit(1);
  if (!org) throw new Forbidden("no app organization for membership");
  const [profile] = await db.select({ deactivatedAt: users.deactivatedAt, name: users.name }).from(users).where(eq(users.id, session.user.id)).limit(1);
  if (profile?.deactivatedAt) throw new Forbidden("user deactivated");
  return { userId: session.user.id, email: session.user.email, name: profile?.name ?? session.user.name, orgId: org.id, authOrgId: m.organizationId, role: m.role as Role, orgType: org.type };
});

export async function authorize(opts?: { roles?: readonly Role[] }): Promise<Ctx> {
  const ctx = await resolve();
  if (!ctx) throw new Unauthorized("not signed in");
  if (opts?.roles && !opts.roles.includes(ctx.role)) throw new Forbidden(`role ${ctx.role} not allowed`);
  return ctx;
}

/** Nullable variant for layouts / the root redirect. */
export async function currentCtx(): Promise<Ctx | null> {
  try { return await resolve(); } catch (e) { if (e instanceof Forbidden) return null; throw e; }
}

export const authorizeClient = () => authorize({ roles: CLIENT_ROLES });
export const authorizeOps = () => authorize({ roles: OPS_ROLES });
export const authorizeAdmin = () => authorize({ roles: ["admin"] });

/* ────────── page/layout guards: same rules as the door layouts, without thrown errors (pages render in parallel with layouts) ────────── */
export async function requireClientPage(nextPath = "/app"): Promise<Ctx> {
  const { redirect } = await import("next/navigation");
  const ctx = await currentCtx();
  if (!ctx) return redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  if (isOps(ctx)) redirect("/ops");
  if (!isClient(ctx)) redirect("/login");
  return ctx;
}

export async function requireOpsPage(nextPath = "/ops"): Promise<Ctx> {
  const { redirect, notFound } = await import("next/navigation");
  const ctx = await currentCtx();
  if (!ctx) return redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  if (!isOps(ctx)) notFound();
  return ctx;
}
