/**
 * QA-10: who owns a line the client created without an agent in the loop (factory-range items, catalog "Request offer").
 * Shared because the range rule reads the supplier schema; client callers only receive a user id (an app-schema column).
 *
 * Order of preference:
 *   range   → the agent of this client's most recent line whose selected supplier is the range's factory
 *   product → the agent of this client's most recent line for that product
 *   then    → the client's most recently active agent, then the range/product creator when they are ops, else null
 *             (a null owner still shows in Queue › Unassigned, see ops/requests.ts + ops/dashboard.ts).
 */
import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import type { DbOrTx } from "@/db";
import { requestLines, factoryRanges, products } from "@/db/schema/app";
import { supplierParticipations } from "@/db/schema/supplier";
import { opsUsers } from "./users";

export async function defaultAgentFor(db: DbOrTx, p: { orgId: string; rangeId?: string | null; productId?: string | null }): Promise<{ id: string; name: string } | null> {
  const ops = await opsUsers(db);
  const byId = new Map(ops.map((u) => [u.id, u]));
  const pick = (id: string | null | undefined) => (id && byId.has(id) ? { id, name: byId.get(id)!.name } : null);

  if (p.rangeId) {
    const [r] = await db.select({ supplierId: factoryRanges.supplierId, createdBy: factoryRanges.createdBy }).from(factoryRanges).where(eq(factoryRanges.id, p.rangeId)).limit(1);
    if (r?.supplierId) {
      const rows = await db.select({ agent: requestLines.assignedAgentId }).from(requestLines)
        .innerJoin(supplierParticipations, eq(supplierParticipations.id, requestLines.selectedParticipationId as never))
        .where(and(eq(requestLines.orgId, p.orgId), eq(supplierParticipations.supplierId, r.supplierId as unknown as string), isNotNull(requestLines.assignedAgentId), isNull(requestLines.deletedAt)))
        .orderBy(desc(requestLines.updatedAt)).limit(5);
      for (const row of rows) { const a = pick(row.agent); if (a) return a; }
    }
    const last = await lastAgentOfOrg(db, p.orgId, pick);
    return last ?? pick(r?.createdBy);
  }
  if (p.productId) {
    const rows = await db.select({ agent: requestLines.assignedAgentId }).from(requestLines)
      .where(and(eq(requestLines.orgId, p.orgId), eq(requestLines.productId, p.productId), isNotNull(requestLines.assignedAgentId), isNull(requestLines.deletedAt))).orderBy(desc(requestLines.updatedAt)).limit(5);
    for (const row of rows) { const a = pick(row.agent); if (a) return a; }
    const last = await lastAgentOfOrg(db, p.orgId, pick);
    if (last) return last;
    const [prod] = await db.select({ createdBy: products.createdBy }).from(products).where(eq(products.id, p.productId)).limit(1);
    return pick(prod?.createdBy);
  }
  return lastAgentOfOrg(db, p.orgId, pick);
}

async function lastAgentOfOrg(db: DbOrTx, orgId: string, pick: (id: string | null | undefined) => { id: string; name: string } | null) {
  const rows = await db.select({ agent: requestLines.assignedAgentId }).from(requestLines)
    .where(and(eq(requestLines.orgId, orgId), isNotNull(requestLines.assignedAgentId), isNull(requestLines.deletedAt))).orderBy(desc(requestLines.updatedAt)).limit(5);
  for (const row of rows) { const a = pick(row.agent); if (a) return a; }
  return null;
}
