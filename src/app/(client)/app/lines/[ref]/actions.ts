"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize, CLIENT_ROLES } from "@/server/shared/authorize";
import { toActionError, type ActionResult } from "@/server/shared/http";
import { askAboutLine } from "@/server/client/comments";

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
