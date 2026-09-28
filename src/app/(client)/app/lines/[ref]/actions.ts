"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize, CLIENT_ROLES } from "@/server/shared/authorize";
import { toActionError, type ActionResult } from "@/server/shared/http";
import { askAboutLine, requestSpecChange, SpecChangeError } from "@/server/client/comments";

const Ask = z.object({ lineRef: z.string().min(1), body: z.string().trim().min(1).max(4000) });

/** F-07 "Ask about this order": client comment + `ops_client_question`; answers a pending `needs_input`. */
export async function askAction(raw: z.input<typeof Ask>): Promise<ActionResult<{ lineRef: string; answered: boolean }>> {
  try {
    const ctx = await authorize({ roles: CLIENT_ROLES });
    const input = Ask.parse(raw);
    const r = await askAboutLine(ctx, input);
    revalidatePath(`/app/lines/${r.lineRef}`); revalidatePath("/app"); revalidatePath(`/ops/lines/${r.lineRef}`);
    return { ok: true, data: { lineRef: r.lineRef, answered: r.answered } };
  } catch (e) { return toActionError(e); }
}

const SpecChange = z.object({ lineRef: z.string().min(1), text: z.string().trim().min(10, "Tell us what should change (at least 10 characters)").max(4000) });

/**
 * QA-08 "Request a change" on a frozen line → `change_request` comment + `change_requested` exception + ops email.
 * Contract (FIX-B): `requestSpecChangeAction({ lineRef, text }) → ActionResult<{ lineRef, commentId }>`;
 * `E_NOT_CHANGEABLE` when the spec is not frozen yet (edit the line instead) or an order already exists.
 */
export async function requestSpecChangeAction(raw: z.input<typeof SpecChange>): Promise<ActionResult<{ lineRef: string; commentId: string }>> {
  try {
    const ctx = await authorize({ roles: CLIENT_ROLES });
    const input = SpecChange.parse(raw);
    const r = await requestSpecChange(ctx, input);
    revalidatePath(`/app/lines/${r.lineRef}`); revalidatePath("/app"); revalidatePath("/app/requests"); revalidatePath(`/ops/lines/${r.lineRef}`); revalidatePath("/ops");
    return { ok: true, data: r };
  } catch (e) {
    if (e instanceof SpecChangeError) return { ok: false, error: e.code, message: "This line can't be changed right now — ask us instead." };
    return toActionError(e);
  }
}
