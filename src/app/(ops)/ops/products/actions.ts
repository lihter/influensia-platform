"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize, OPS_ROLES } from "@/server/shared/authorize";
import { toActionError, type ActionResult } from "@/server/shared/http";
import { createProduct, updateProduct, publishProduct, unpublishProduct, uploadProductImage, approveImageAsClean, removeImage, ProductPublishError, PRODUCT_CATEGORIES, IMAGE_KINDS } from "@/server/ops/products";

const opt = z.string().trim().max(2000).optional().nullable();
const ProductSchema = z.object({
  name: z.string().trim().min(2, "Name is required").max(200),
  category: z.enum(PRODUCT_CATEGORIES).nullable().optional().or(z.literal("")),
  description: z.string().trim().max(8000).optional().nullable(),
  hsCode: opt,
  unit: z.string().trim().min(1).max(12).optional(),
  ownerOrgId: z.uuid().nullable().optional().or(z.literal("")),
});
/** Money comes in as "8.90" / "0.062" (USD per unit) and is stored as minor×100 (SPEC B.6). */
const price = z.string().trim().regex(/^\d+([.,]\d{1,4})?$/, "Use a number like 8.90 or 0.0539").optional().or(z.literal(""));
const RefSchema = z.object({
  referencePrice: price,
  referenceMoq: z.string().trim().regex(/^\d*$/, "Whole number").optional().or(z.literal("")),
  referenceIncoterm: z.string().trim().max(8).optional().or(z.literal("")),
  referencePort: z.string().trim().max(60).optional().or(z.literal("")),
  referenceSpecVersion: z.string().trim().regex(/^\d*$/, "Whole number").optional().or(z.literal("")),
  referenceValidUntil: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/, "Use YYYY-MM-DD").optional().or(z.literal("")),
});
export type ProductFormInput = z.input<typeof ProductSchema>;
export type ReferenceFormInput = z.input<typeof RefSchema>;

const toE2 = (s?: string) => (s ? Math.round(Number(s.replace(",", ".")) * 10000) : null);
const toInt = (s?: string) => (s ? Number(s) : null);
const refPatch = (r: z.output<typeof RefSchema>) => ({
  referencePriceMinorE2: toE2(r.referencePrice), referenceMoq: toInt(r.referenceMoq), referenceIncoterm: r.referenceIncoterm || null, referencePort: r.referencePort || null,
  referenceSpecVersion: toInt(r.referenceSpecVersion), referenceValidUntil: r.referenceValidUntil || null,
});

export async function createProductAction(raw: ProductFormInput): Promise<ActionResult<{ id: string; ref: string }>> {
  try {
    const ctx = await authorize({ roles: OPS_ROLES });
    const i = ProductSchema.parse(raw);
    const r = await createProduct(ctx, { name: i.name, category: i.category || null, description: i.description ?? null, hsCode: i.hsCode ?? null, unit: i.unit, ownerOrgId: i.ownerOrgId || null });
    revalidatePath("/ops/products");
    return { ok: true, data: r };
  } catch (e) {
    return toActionError(e);
  }
}

export async function updateProductAction(raw: { id: string } & ProductFormInput & ReferenceFormInput): Promise<ActionResult<{ ref: string }>> {
  try {
    const ctx = await authorize({ roles: OPS_ROLES });
    const { id } = z.object({ id: z.uuid() }).parse(raw);
    const i = ProductSchema.parse(raw);
    const rr = RefSchema.parse(raw);
    const r = await updateProduct(ctx, id, { name: i.name, category: i.category || null, description: i.description ?? null, hsCode: i.hsCode ?? null, unit: i.unit, ownerOrgId: i.ownerOrgId === "" ? null : i.ownerOrgId, ...refPatch(rr) });
    revalidatePath("/ops/products");
    revalidatePath(`/ops/products/${r.ref}`);
    revalidatePath("/app/catalog");
    return { ok: true, data: r };
  } catch (e) {
    return toActionError(e);
  }
}

/** Admin: validates the five reference attributes + valid-until (+ clean image unless withoutImage), leak-checks, publishes. */
export async function publishProductAction(raw: { id: string; withoutImage?: boolean } & ReferenceFormInput): Promise<ActionResult<{ ref: string }>> {
  try {
    const ctx = await authorize({ roles: ["admin"] });
    const { id, withoutImage } = z.object({ id: z.uuid(), withoutImage: z.boolean().optional() }).parse(raw);
    const rr = RefSchema.parse(raw);
    const r = await publishProduct(ctx, id, { withoutImage, ...refPatch(rr) });
    revalidatePath("/ops/products");
    revalidatePath(`/ops/products/${r.ref}`);
    revalidatePath("/app/catalog");
    return { ok: true, data: r };
  } catch (e) {
    if (e instanceof ProductPublishError) return { ok: false, error: e.code, errors: e.errors };
    return toActionError(e);
  }
}

export async function unpublishProductAction(raw: { id: string }): Promise<ActionResult<{ ref: string }>> {
  try {
    const ctx = await authorize({ roles: ["admin"] });
    const { id } = z.object({ id: z.uuid() }).parse(raw);
    const r = await unpublishProduct(ctx, id);
    revalidatePath("/ops/products");
    revalidatePath(`/ops/products/${r.ref}`);
    revalidatePath("/app/catalog");
    return { ok: true, data: r };
  } catch (e) {
    return toActionError(e);
  }
}

/** FormData: file, productId, productRef, kind. Images ≤ 15 MB, png/jpg/webp. */
export async function uploadProductImageAction(fd: FormData): Promise<ActionResult<{ imageId: string }>> {
  try {
    const ctx = await authorize({ roles: OPS_ROLES });
    const meta = z.object({ productId: z.uuid(), productRef: z.string(), kind: z.enum(IMAGE_KINDS) }).parse({ productId: fd.get("productId"), productRef: fd.get("productRef"), kind: fd.get("kind") });
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) return { ok: false, error: "E_VALIDATION", errors: { file: "Choose an image" } };
    if (file.size > 15 * 1024 * 1024) return { ok: false, error: "E_VALIDATION", errors: { file: "Max 15 MB" } };
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return { ok: false, error: "E_VALIDATION", errors: { file: "png, jpg or webp" } };
    const r = await uploadProductImage(ctx, { productId: meta.productId, kind: meta.kind, data: Buffer.from(await file.arrayBuffer()), mime: file.type, filename: file.name });
    revalidatePath(`/ops/products/${meta.productRef}`);
    revalidatePath("/app/catalog");
    return { ok: true, data: r };
  } catch (e) {
    return toActionError(e);
  }
}

export async function approveImageAction(raw: { imageId: string; productRef: string }): Promise<ActionResult<{ imageId: string }>> {
  try {
    const ctx = await authorize({ roles: OPS_ROLES });
    const { imageId, productRef } = z.object({ imageId: z.uuid(), productRef: z.string() }).parse(raw);
    const r = await approveImageAsClean(ctx, imageId);
    revalidatePath(`/ops/products/${productRef}`);
    revalidatePath("/app/catalog");
    return { ok: true, data: r };
  } catch (e) {
    return toActionError(e);
  }
}

export async function removeImageAction(raw: { imageId: string; productRef: string }): Promise<ActionResult<undefined>> {
  try {
    const ctx = await authorize({ roles: OPS_ROLES });
    const { imageId, productRef } = z.object({ imageId: z.uuid(), productRef: z.string() }).parse(raw);
    await removeImage(ctx, imageId);
    revalidatePath(`/ops/products/${productRef}`);
    revalidatePath("/app/catalog");
    return { ok: true, data: undefined };
  } catch (e) {
    return toActionError(e);
  }
}
