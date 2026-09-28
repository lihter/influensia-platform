/**
 * Line mutations shared by the ops dashboard (foundation) and the queue (feature). Every mutation logs activity.
 */
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { requestLines } from "@/db/schema/app";
import { type Ctx, isOps, Forbidden, NotFound } from "@/server/shared/authorize";
import { logActivity } from "@/server/shared/activity";
import { transition } from "@/server/shared/transition";
import { now } from "@/server/shared/clock";

/** Claim (assign to me) / assign: sets assigned_agent_id and, when the line is `submitted`, moves it to `in_review` (SPEC 3.4). */
export async function assignLine(ctx: Ctx, lineId: string, agentId: string, agentName: string): Promise<{ lineRef: string }> {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [line] = await tx.select().from(requestLines).where(eq(requestLines.id, lineId)).for("update");
    if (!line || line.deletedAt) throw new NotFound("line");
    const at = now();
    await tx.update(requestLines).set({ assignedAgentId: agentId, updatedAt: at }).where(eq(requestLines.id, lineId));
    await logActivity(tx, { orgId: line.orgId, entityType: "request_line", entityId: lineId, type: "line_assigned", actorId: ctx.userId, actorName: ctx.name, visibility: "internal", at, payload: { ref: line.lineRef, agentId, agentName } });
    if (line.state === "submitted") await transition(lineId, "in_review", ctx, { tx, at, payload: { agentName } });
    return { lineRef: line.lineRef };
  });
}

export const claimLine = (ctx: Ctx, lineId: string) => assignLine(ctx, lineId, ctx.userId, ctx.name);
