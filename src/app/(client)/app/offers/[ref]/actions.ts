"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize, CLIENT_ROLES } from "@/server/shared/authorize";
import { toActionError, type ActionResult } from "@/server/shared/http";
import { acceptOffer, requestOfferChanges, declineOffer, DECLINE_REASONS } from "@/server/client/offers";

const refresh = (ref: string, lineRef: string) => { revalidatePath(`/app/offers/${ref}`); revalidatePath(`/app/lines/${lineRef}`); revalidatePath("/app"); revalidatePath(`/ops/lines/${lineRef}`); revalidatePath("/ops"); };

const Accept = z.object({ ref: z.string().min(1), optionLabel: z.enum(["A", "B", "C"]) });
export async function acceptOfferAction(raw: z.input<typeof Accept>): Promise<ActionResult<{ lineRef: string; sampleRequired: boolean }>> {
  try { const ctx = await authorize({ roles: CLIENT_ROLES }); const i = Accept.parse(raw); const r = await acceptOffer(ctx, i); refresh(i.ref, r.lineRef); return { ok: true, data: r }; } catch (e) { return toActionError(e); }
}

const Changes = z.object({ ref: z.string().min(1), text: z.string().trim().min(10, "At least 10 characters").max(4000) });
export async function requestChangesAction(raw: z.input<typeof Changes>): Promise<ActionResult<{ lineRef: string }>> {
  try { const ctx = await authorize({ roles: CLIENT_ROLES }); const i = Changes.parse(raw); const r = await requestOfferChanges(ctx, i); refresh(i.ref, r.lineRef); return { ok: true, data: r }; } catch (e) { return toActionError(e); }
}

const Decline = z.object({ ref: z.string().min(1), reason: z.enum(DECLINE_REASONS), text: z.string().trim().max(2000).nullish() });
export async function declineOfferAction(raw: z.input<typeof Decline>): Promise<ActionResult<{ lineRef: string }>> {
  try { const ctx = await authorize({ roles: CLIENT_ROLES }); const i = Decline.parse(raw); const r = await declineOffer(ctx, i); refresh(i.ref, r.lineRef); return { ok: true, data: r }; } catch (e) { return toActionError(e); }
}
