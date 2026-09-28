/**
 * "Request these items" from a published factory range (SPEC F-25, AC-RNG-03): pre-creates the `selected`
 * participation for the range's factory on a new line. Shared so client code never touches the supplier schema
 * (this helper does, internally) and never receives supplier data back — it returns only the participation id, which
 * the caller stores in the ServerOnly `selected_participation_id` column.
 */
import { eq } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import type { DbOrTx } from "@/db";
import { requestLines, factoryRanges } from "@/db/schema/app";
import { supplierParticipations } from "@/db/schema/supplier";
import { logActivity } from "./activity";
import { now } from "./clock";
import type { Ctx } from "./authorize";

export async function createRangeRequest(
  tx: DbOrTx,
  ctx: Ctx,
  p: { rangeId: string; lineId: string; lineRef: string; factoryLabel: string; at?: Date },
): Promise<{ participationId: string }> {
  const at = p.at ?? now();
  const [r] = await tx.select({ supplierId: factoryRanges.supplierId, ref: factoryRanges.ref }).from(factoryRanges).where(eq(factoryRanges.id, p.rangeId)).limit(1);
  if (!r) throw new Error("range not found");
  const participationId = uuidv7();
  await tx.insert(supplierParticipations).values({
    id: participationId, requestLineId: p.lineId, supplierId: r.supplierId as unknown as string, status: "selected",
    reason: `From Factory ${p.factoryLabel} range item`, firstContactAt: at, lastContactAt: at, createdBy: ctx.userId, createdAt: at, updatedAt: at,
  });
  await tx.update(requestLines).set({ selectedParticipationId: participationId as never, updatedAt: at }).where(eq(requestLines.id, p.lineId));
  await logActivity(tx, { orgId: ctx.orgId, entityType: "request_line", entityId: p.lineId, type: "participation_added", actorId: ctx.userId, actorName: ctx.name, visibility: "internal", at, payload: { ref: p.lineRef, status: "selected", source: "factory_range", rangeRef: r.ref } });
  return { participationId };
}
