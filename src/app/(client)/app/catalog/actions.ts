"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize, CLIENT_ROLES } from "@/server/shared/authorize";
import { toActionError, type ActionResult } from "@/server/shared/http";
import { requestOffer } from "@/server/client/catalog";
import type { ClientCatalogRequestDto } from "@/server/client/dto/catalog";

const Input = z.object({
  productRef: z.string().regex(/^PRD-\d{4}$/),
  qty: z.coerce.number().int().positive("Quantity must be a whole number above 0").max(100_000_000),
  note: z.string().trim().max(2000).optional().nullable(),
});

/** F-11 "Request offer": one request, one line pre-linked to the catalog product, straight to `submitted`. */
export async function requestOfferAction(raw: { productRef: string; qty: number | string; note?: string | null }): Promise<ActionResult<ClientCatalogRequestDto>> {
  try {
    const ctx = await authorize({ roles: CLIENT_ROLES });
    const input = Input.parse(raw);
    const r = await requestOffer(ctx, input);
    revalidatePath("/app");
    revalidatePath("/app/requests");
    revalidatePath("/ops/queue");
    return { ok: true, data: r };
  } catch (e) {
    return toActionError(e);
  }
}
