"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize, CLIENT_ROLES } from "@/server/shared/authorize";
import { submitDraftRequest, deleteDraftRequest } from "@/server/client/requests";
import { toActionError, type ActionResult } from "@/server/shared/http";

const Input = z.object({ requestId: z.uuid() });

/** F-06 draft → "Send request": every draft line → submitted (transition), request_submitted event, outbox rows. */
export async function submitDraftAction(raw: { requestId: string }): Promise<ActionResult<{ ref: string }>> {
  try {
    const ctx = await authorize({ roles: CLIENT_ROLES });
    const r = await submitDraftRequest(ctx, Input.parse(raw).requestId);
    revalidatePath("/app");
    revalidatePath("/app/requests");
    revalidatePath(`/app/requests/${r.ref}`);
    revalidatePath("/ops/queue");
    return { ok: true, data: r };
  } catch (e) {
    return toActionError(e);
  }
}

/** F-06 draft → delete (soft). */
export async function deleteDraftAction(raw: { requestId: string }): Promise<ActionResult<{ ref: string }>> {
  try {
    const ctx = await authorize({ roles: CLIENT_ROLES });
    const r = await deleteDraftRequest(ctx, Input.parse(raw).requestId);
    revalidatePath("/app");
    revalidatePath("/app/requests");
    return { ok: true, data: r };
  } catch (e) {
    return toActionError(e);
  }
}
