"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize, OPS_ROLES } from "@/server/shared/authorize";
import { assignLine, claimLine } from "@/server/ops/lines";
import { listAgents } from "@/server/ops/requests";
import { toActionError, type ActionResult } from "@/server/shared/http";

const ClaimInput = z.object({ lineId: z.uuid() });
const AssignInput = z.object({ lineIds: z.array(z.uuid()).min(1).max(100), agentId: z.string().min(1) });

const revalidate = () => { for (const p of ["/ops", "/ops/queue", "/ops/requests"]) revalidatePath(p); };

/** F-14 Claim: assign to me + submitted → in_review (line_assigned internal + state_changed client-visible). */
export async function claimQueueLineAction(raw: { lineId: string }): Promise<ActionResult<{ lineRef: string }>> {
  try {
    const ctx = await authorize({ roles: OPS_ROLES });
    const r = await claimLine(ctx, ClaimInput.parse(raw).lineId);
    revalidate();
    return { ok: true, data: r };
  } catch (e) {
    return toActionError(e);
  }
}

/** F-14 Assign (single or bulk): requires an agent; a `submitted` line moves to `in_review`. */
export async function assignQueueLinesAction(raw: { lineIds: string[]; agentId: string }): Promise<ActionResult<{ lineRefs: string[]; agentName: string }>> {
  try {
    const ctx = await authorize({ roles: OPS_ROLES });
    const input = AssignInput.parse(raw);
    const agent = (await listAgents(ctx)).find((a) => a.id === input.agentId);
    if (!agent) return { ok: false, error: "E_VALIDATION", errors: { agentId: "Choose an agent" } };
    const lineRefs: string[] = [];
    for (const lineId of input.lineIds) lineRefs.push((await assignLine(ctx, lineId, agent.id, agent.name)).lineRef);
    revalidate();
    return { ok: true, data: { lineRefs, agentName: agent.name } };
  } catch (e) {
    return toActionError(e);
  }
}
