"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize, CLIENT_ROLES } from "@/server/shared/authorize";
import { submitDraftRequest, deleteDraftRequest } from "@/server/client/requests";
import { toActionError, type ActionResult } from "@/server/shared/http";
import { askAboutRequest } from "@/server/client/comments";

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

const AskRequest = z.object({ requestRef: z.string().regex(/^REQ-\d{4}-\d{4}$/), body: z.string().trim().min(2, "Write your question").max(4000) });

/** QA-08 "Ask about this request" (F-06). Contract (FIX-B): `askAboutRequestAction({ requestRef, body }) → ActionResult<{ requestRef, commentId }>`. */
export async function askAboutRequestAction(raw: z.input<typeof AskRequest>): Promise<ActionResult<{ requestRef: string; commentId: string }>> {
  try {
    const ctx = await authorize({ roles: CLIENT_ROLES });
    const r = await askAboutRequest(ctx, AskRequest.parse(raw));
    revalidatePath(`/app/requests/${r.requestRef}`); revalidatePath("/app"); revalidatePath(`/ops/requests/${r.requestRef}`);
    return { ok: true, data: r };
  } catch (e) {
    return toActionError(e);
  }
}
