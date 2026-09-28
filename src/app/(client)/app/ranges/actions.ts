"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize, CLIENT_ROLES } from "@/server/shared/authorize";
import { toActionError, type ActionResult } from "@/server/shared/http";
import { requestRangeItems } from "@/server/client/ranges";
import type { ClientRangeRequestDto } from "@/server/client/dto/ranges";

const Input = z.object({
  rangeId: z.uuid(),
  items: z.array(z.object({ itemId: z.uuid(), qty: z.coerce.number().int().positive().max(100_000_000) })).min(1, "Select at least one item").max(50),
  note: z.string().trim().max(2000).optional().nullable(),
});

/** F-25 "Request these items": one request, one line per item, straight to `negotiating` with the factory pre-selected. */
export async function requestRangeItemsAction(raw: { rangeId: string; items: { itemId: string; qty: number | string }[]; note?: string | null }): Promise<ActionResult<ClientRangeRequestDto>> {
  try {
    const ctx = await authorize({ roles: CLIENT_ROLES });
    const input = Input.parse(raw);
    const r = await requestRangeItems(ctx, input);
    revalidatePath("/app");
    revalidatePath("/app/requests");
    revalidatePath("/ops/queue");
    return { ok: true, data: r };
  } catch (e) {
    return toActionError(e);
  }
}
