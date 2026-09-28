"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize, OPS_ROLES } from "@/server/shared/authorize";
import { claimLine } from "@/server/ops/lines";
import { toActionError, type ActionResult } from "@/server/shared/http";

const Input = z.object({ lineId: z.uuid() });

/** F-13 "Claim": assign to me + submitted → in_review. */
export async function claimLineAction(raw: { lineId: string }): Promise<ActionResult<{ lineRef: string }>> {
  try {
    const ctx = await authorize({ roles: OPS_ROLES });
    const input = Input.parse(raw);
    const r = await claimLine(ctx, input.lineId);
    revalidatePath("/ops");
    return { ok: true, data: r };
  } catch (e) {
    return toActionError(e);
  }
}
