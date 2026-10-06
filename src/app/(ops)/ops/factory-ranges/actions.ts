"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize, OPS_ROLES } from "@/server/shared/authorize";
import { toActionError, type ActionResult } from "@/server/shared/http";
import { UNITS } from "@/server/ops/participations";
import { createRange, uploadRangePdf, addRangeItem, updateRangeItem, removeRangeItem, uploadRangeItemImage, checkRange, publishRange, unpublishRange, setRangeDisplayName, type RangeLeakReport } from "@/server/ops/ranges";

const ItemSchema = z.object({
  name: z.string().trim().min(2, "Name is required").max(200),
  productId: z.uuid().nullable().optional().or(z.literal("")),
  moq: z.string().trim().regex(/^\d{0,9}$/, "Whole number (up to 9 digits)").optional().or(z.literal("")),
  price: z.string().trim().regex(/^(\d+([.,]\d{1,4})?)?$/, "Use a number like 0.058").optional().or(z.literal("")),
  currency: z.string().trim().length(3).optional(),
  // QA-43: a unit is a unit ("pcs", "set"…), never a number like "0.31"
  unit: z.string().trim().toLowerCase().refine((u) => (UNITS as readonly string[]).includes(u), { message: `Unit must be one of: ${UNITS.join(", ")}` }).optional().or(z.literal("").transform(() => undefined)),
  madeHere: z.enum(["yes", "no", "unknown"]).optional(),
  note: z.string().trim().max(500).optional().nullable(),
});
export type RangeItemFormInput = z.input<typeof ItemSchema>;
const toItem = (i: z.output<typeof ItemSchema>) => ({
  name: i.name, productId: i.productId || null, moq: i.moq ? Number(i.moq) : null, priceMinorE2: i.price ? Math.round(Number(i.price.replace(",", ".")) * 10000) : null,
  currency: i.currency ?? "USD", unit: i.unit ?? "pcs", madeHere: i.madeHere === "yes" ? true : i.madeHere === "no" ? false : null, note: i.note ?? null,
});

export async function createRangeAction(raw: { supplierId: string; orgId: string }): Promise<ActionResult<{ id: string; ref: string }>> {
  try {
    const ctx = await authorize({ roles: OPS_ROLES });
    const input = z.object({ supplierId: z.uuid(), orgId: z.uuid() }).parse(raw);
    const r = await createRange(ctx, input);
    revalidatePath("/ops/factory-ranges");
    return { ok: true, data: r };
  } catch (e) {
    return toActionError(e);
  }
}

/** FormData: file (pdf), rangeId, rangeRef. */
export async function uploadRangePdfAction(fd: FormData): Promise<ActionResult<{ fileId: string }>> {
  try {
    const ctx = await authorize({ roles: OPS_ROLES });
    const meta = z.object({ rangeId: z.uuid(), rangeRef: z.string() }).parse({ rangeId: fd.get("rangeId"), rangeRef: fd.get("rangeRef") });
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) return { ok: false, error: "E_VALIDATION", errors: { file: "Choose a PDF" } };
    if (file.size > 25 * 1024 * 1024) return { ok: false, error: "E_VALIDATION", errors: { file: "Max 25 MB" } };
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) return { ok: false, error: "E_VALIDATION", errors: { file: "PDF only" } };
    const r = await uploadRangePdf(ctx, { rangeId: meta.rangeId, data: Buffer.from(await file.arrayBuffer()), mime: "application/pdf", filename: file.name });
    revalidatePath(`/ops/factory-ranges/${meta.rangeRef}`);
    return { ok: true, data: r };
  } catch (e) {
    return toActionError(e);
  }
}

export async function addRangeItemAction(raw: { rangeId: string; rangeRef: string } & RangeItemFormInput): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await authorize({ roles: OPS_ROLES });
    const { rangeId, rangeRef } = z.object({ rangeId: z.uuid(), rangeRef: z.string() }).parse(raw);
    const r = await addRangeItem(ctx, rangeId, toItem(ItemSchema.parse(raw)));
    revalidatePath(`/ops/factory-ranges/${rangeRef}`);
    return { ok: true, data: r };
  } catch (e) {
    return toActionError(e);
  }
}

export async function updateRangeItemAction(raw: { itemId: string; rangeRef: string } & RangeItemFormInput): Promise<ActionResult<undefined>> {
  try {
    const ctx = await authorize({ roles: OPS_ROLES });
    const { itemId, rangeRef } = z.object({ itemId: z.uuid(), rangeRef: z.string() }).parse(raw);
    await updateRangeItem(ctx, itemId, toItem(ItemSchema.parse(raw)));
    revalidatePath(`/ops/factory-ranges/${rangeRef}`);
    revalidatePath("/app/catalog");
    return { ok: true, data: undefined };
  } catch (e) {
    return toActionError(e);
  }
}

export async function removeRangeItemAction(raw: { itemId: string; rangeRef: string }): Promise<ActionResult<undefined>> {
  try {
    const ctx = await authorize({ roles: OPS_ROLES });
    const { itemId, rangeRef } = z.object({ itemId: z.uuid(), rangeRef: z.string() }).parse(raw);
    await removeRangeItem(ctx, itemId);
    revalidatePath(`/ops/factory-ranges/${rangeRef}`);
    return { ok: true, data: undefined };
  } catch (e) {
    return toActionError(e);
  }
}

/** FormData: file (image), itemId, rangeRef. */
export async function uploadRangeItemImageAction(fd: FormData): Promise<ActionResult<{ fileId: string }>> {
  try {
    const ctx = await authorize({ roles: OPS_ROLES });
    const meta = z.object({ itemId: z.uuid(), rangeRef: z.string() }).parse({ itemId: fd.get("itemId"), rangeRef: fd.get("rangeRef") });
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) return { ok: false, error: "E_VALIDATION", errors: { file: "Choose an image" } };
    if (file.size > 15 * 1024 * 1024) return { ok: false, error: "E_VALIDATION", errors: { file: "Max 15 MB" } };
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return { ok: false, error: "E_VALIDATION", errors: { file: "png, jpg or webp" } };
    const r = await uploadRangeItemImage(ctx, { itemId: meta.itemId, data: Buffer.from(await file.arrayBuffer()), mime: file.type, filename: file.name });
    revalidatePath(`/ops/factory-ranges/${meta.rangeRef}`);
    return { ok: true, data: r };
  } catch (e) {
    return toActionError(e);
  }
}

export async function checkRangeAction(raw: { rangeId: string }): Promise<ActionResult<RangeLeakReport>> {
  try {
    const ctx = await authorize({ roles: OPS_ROLES });
    const { rangeId } = z.object({ rangeId: z.uuid() }).parse(raw);
    return { ok: true, data: await checkRange(ctx, rangeId) };
  } catch (e) {
    return toActionError(e);
  }
}

/** Admin: leak check → label from the FACTORY_LABEL sequence → client copies → `range_published` + client_new_update. */
export async function publishRangeAction(raw: { rangeId: string; rangeRef: string }): Promise<ActionResult<{ ref: string; label: string }>> {
  try {
    const ctx = await authorize({ roles: ["admin"] });
    const { rangeId, rangeRef } = z.object({ rangeId: z.uuid(), rangeRef: z.string() }).parse(raw);
    const r = await publishRange(ctx, rangeId);
    revalidatePath("/ops/factory-ranges");
    revalidatePath(`/ops/factory-ranges/${rangeRef}`);
    revalidatePath("/app/catalog");
    return { ok: true, data: r };
  } catch (e) {
    revalidatePath(`/ops/factory-ranges/${raw.rangeRef}`);
    return toActionError(e);
  }
}

export async function unpublishRangeAction(raw: { rangeId: string; rangeRef: string }): Promise<ActionResult<{ ref: string }>> {
  try {
    const ctx = await authorize({ roles: ["admin"] });
    const { rangeId, rangeRef } = z.object({ rangeId: z.uuid(), rangeRef: z.string() }).parse(raw);
    const r = await unpublishRange(ctx, rangeId);
    revalidatePath("/ops/factory-ranges");
    revalidatePath(`/ops/factory-ranges/${rangeRef}`);
    revalidatePath("/app/catalog");
    return { ok: true, data: r };
  } catch (e) {
    return toActionError(e);
  }
}

export async function setRangeDisplayNameAction(raw: { rangeId: string; rangeRef: string; displayName: string }): Promise<ActionResult<undefined>> {
  try {
    const ctx = await authorize({ roles: OPS_ROLES });
    const i = z.object({ rangeId: z.uuid(), rangeRef: z.string(), displayName: z.string().trim().max(80, "Keep it under 80 characters") }).parse(raw);
    await setRangeDisplayName(ctx, i.rangeId, i.displayName || null);
    revalidatePath(`/ops/factory-ranges/${i.rangeRef}`);
    return { ok: true, data: undefined };
  } catch (e) {
    return toActionError(e);
  }
}
