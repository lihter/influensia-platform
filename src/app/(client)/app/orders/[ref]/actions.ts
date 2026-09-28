"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize, CLIENT_ROLES } from "@/server/shared/authorize";
import { toActionError, type ActionResult } from "@/server/shared/http";
import { confirmDelivery, uploadArtwork, askAboutOrder, reorder, ClientOrderError } from "@/server/client/orders";
import type { ClientReorderResultDto } from "@/server/client/dto/orders";

const ref = z.string().regex(/^ORD-\d{4}-\d{4}(-[A-Z])?$/);
const ARTWORK_MIME = /^(application\/pdf|application\/postscript|application\/illustrator|image\/(png|jpeg))$/;
const ARTWORK_EXT = /\.(pdf|ai|png|jpe?g)$/i;

function fail(e: unknown): ActionResult<never> {
  if (e instanceof ClientOrderError) return { ok: false, error: e.code };
  return toActionError(e);
}
const done = (r: string) => { revalidatePath(`/app/orders/${r}`); revalidatePath("/app"); revalidatePath("/app/requests"); };

const Confirm = z.object({ ref, issues: z.string().trim().max(1000).optional() });
/** F-10 "Confirm delivery" → completed. */
export async function confirmDeliveryAction(raw: z.input<typeof Confirm>): Promise<ActionResult<{ ref: string }>> {
  try { const ctx = await authorize({ roles: CLIENT_ROLES }); const i = Confirm.parse(raw); const r = await confirmDelivery(ctx, i.ref, i.issues ?? null); done(r.ref); return { ok: true, data: r }; } catch (e) { return fail(e); }
}

/** F-10 "Upload artwork": multipart (file ≤ 25 MB, pdf/ai/png/jpg), note ≤ 500. */
export async function uploadArtworkAction(fd: FormData): Promise<ActionResult<{ ref: string; artworkId: string; version: number }>> {
  try {
    const ctx = await authorize({ roles: CLIENT_ROLES });
    const orderRef = ref.parse(fd.get("ref"));
    const orderLineId = z.uuid().parse(fd.get("orderLineId"));
    const note = z.string().trim().max(500).parse(String(fd.get("note") ?? ""));
    const f = fd.get("file");
    if (!(f instanceof File) || f.size === 0) throw new z.ZodError([{ code: "custom", path: ["file"], message: "Choose a file", input: null }]);
    if (f.size > 25 * 1024 * 1024) throw new z.ZodError([{ code: "custom", path: ["file"], message: "File is larger than 25 MB", input: f.size }]);
    if (!ARTWORK_MIME.test(f.type) && !ARTWORK_EXT.test(f.name)) throw new z.ZodError([{ code: "custom", path: ["file"], message: "PDF, AI, PNG or JPG only", input: f.type }]);
    const r = await uploadArtwork(ctx, orderRef, { orderLineId, filename: f.name, mime: f.type || "application/octet-stream", data: Buffer.from(await f.arrayBuffer()), note: note || null });
    done(r.ref);
    return { ok: true, data: r };
  } catch (e) { return fail(e); }
}

const Ask = z.object({ ref, text: z.string().trim().min(3).max(2000) });
/** F-10 "Ask about this order". */
export async function askAboutOrderAction(raw: z.input<typeof Ask>): Promise<ActionResult<{ ref: string; commentId: string }>> {
  try { const ctx = await authorize({ roles: CLIENT_ROLES }); const i = Ask.parse(raw); const r = await askAboutOrder(ctx, i.ref, i.text); done(r.ref); return { ok: true, data: r }; } catch (e) { return fail(e); }
}

const Reorder = z.object({ ref, lines: z.array(z.object({ orderLineId: z.uuid(), qty: z.number().int().positive() })).min(1) });
/** F-12 "Reorder" → new request flagged repeat. */
export async function reorderAction(raw: z.input<typeof Reorder>): Promise<ActionResult<ClientReorderResultDto>> {
  try { const ctx = await authorize({ roles: CLIENT_ROLES }); const i = Reorder.parse(raw); const r = await reorder(ctx, i.ref, { lines: i.lines }); done(i.ref); return { ok: true, data: r }; } catch (e) { return fail(e); }
}
