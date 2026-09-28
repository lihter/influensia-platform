/**
 * Recipient lookups (SPEC §6): client = all active users of the entity's org; ops-all = every agent + admin.
 * Returns plain {id, email, name, role} — never emails of agents to client code (callers decide what to expose).
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { DbOrTx } from "@/db";
import { users, organizations } from "@/db/schema/app";
import { member } from "@/db/schema/auth";
import type { Role } from "@/db/enums";

export type UserRef = { id: string; email: string; name: string; role: Role; orgId: string };

export async function clientUsersOf(db: DbOrTx, orgId: string): Promise<UserRef[]> {
  const rows = await db
    .select({ id: users.id, email: users.email, name: users.name, orgId: users.orgId, role: member.role })
    .from(users)
    .innerJoin(member, eq(member.userId, users.id))
    .where(and(eq(users.orgId, orgId), isNull(users.deactivatedAt), inArray(member.role, ["client_owner", "client_member"])));
  return rows.map((r) => ({ ...r, role: r.role as Role }));
}

export async function opsUsers(db: DbOrTx): Promise<UserRef[]> {
  const rows = await db
    .select({ id: users.id, email: users.email, name: users.name, orgId: users.orgId, role: member.role })
    .from(users)
    .innerJoin(member, eq(member.userId, users.id))
    .where(and(isNull(users.deactivatedAt), inArray(member.role, ["admin", "agent"])));
  return rows.map((r) => ({ ...r, role: r.role as Role }));
}

export async function userById(db: DbOrTx, id: string): Promise<UserRef | null> {
  const [r] = await db
    .select({ id: users.id, email: users.email, name: users.name, orgId: users.orgId, role: member.role })
    .from(users)
    .innerJoin(member, eq(member.userId, users.id))
    .where(eq(users.id, id))
    .limit(1);
  return r ? { ...r, role: r.role as Role } : null;
}

/** Display names for a set of user ids (agents' names are allowed in client DTOs; emails are not). */
export async function userNames(db: DbOrTx, ids: string[]): Promise<Record<string, string>> {
  const clean = [...new Set(ids.filter(Boolean))];
  if (!clean.length) return {};
  const rows = await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, clean));
  return Object.fromEntries(rows.map((r) => [r.id, r.name]));
}

export async function agencyOrg(db: DbOrTx) {
  const [o] = await db.select().from(organizations).where(eq(organizations.type, "agency")).limit(1);
  return o ?? null;
}
