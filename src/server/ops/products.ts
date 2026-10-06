/**
 * Products / catalog admin (SPEC F-24). Ops sees everything (owner org, supplier-facing images, orders by client);
 * publishing to the catalog validates the five reference-price attributes, requires a clean image (or an explicit
 * "publish without image"), leak-checks name + description and logs `product_published`.
 */
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { getDb } from "@/db";
import { products, productSpecs, productImages, files, organizations, requestLines, requests, orderLines, orders } from "@/db/schema/app";
import { supplierParticipations, suppliers } from "@/db/schema/supplier";
import { type Ctx, isOps, isAdmin, Forbidden, NotFound } from "@/server/shared/authorize";
import { logActivity } from "@/server/shared/activity";
import { storeUpload } from "@/server/shared/files";
import { assertClean, loadLeakSources } from "@/server/shared/leak-check";
import { nextRef } from "@/server/shared/ids";
import { now, today } from "@/server/shared/clock";
import { userNames } from "@/server/shared/users";
import { PRODUCT_CATEGORIES, PRODUCT_VISIBILITIES, IMAGE_KINDS, type ProductCategory, type ProductVisibility, type ImageKind, type LineState } from "@/db/enums";
import { productThumbs, OPS_MEDIA, type Thumb } from "@/server/shared/media";

export { PRODUCT_CATEGORIES, PRODUCT_VISIBILITIES, IMAGE_KINDS };
export type { ProductCategory, ProductVisibility, ImageKind };
export const INCOTERMS = ["FOB", "EXW", "CIF", "DDP", "DAP", "FCA"] as const;

/* ───────────────────────── list ───────────────────────── */

export type ProductRow = {
  id: string; ref: string; name: string; category: string | null; unit: string; visibility: ProductVisibility; ownerOrgName: string | null;
  referencePriceMinorE2: number | null; referenceCurrency: string; referenceMoq: number | null; referenceIncoterm: string | null; referencePort: string | null;
  referenceSpecVersion: number | null; referenceValidUntil: string | null; priceStale: boolean; priceExpiring: boolean; specVersions: number; cleanImages: number;
  image: Thumb | null;
  linesCount: number; ordersCount: number; publishedAt: string | null; updatedAt: string | null;
};

export type ProductFilters = { q?: string; visibility?: ProductVisibility | ""; category?: string; ownerOrgId?: string; expiring?: boolean };

export async function listProducts(ctx: Ctx, f: ProductFilters = {}): Promise<ProductRow[]> {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const db = await getDb();
  const rows = await db.select({ p: products, ownerOrgName: organizations.name }).from(products).leftJoin(organizations, eq(organizations.id, products.ownerOrgId)).where(isNull(products.deletedAt)).orderBy(products.ref);
  if (!rows.length) return [];
  const ids = rows.map((r) => r.p.id);
  const [thumbs, specs, imgs, lines, ols] = await Promise.all([
    productThumbs(db, ids, OPS_MEDIA),
    db.select({ productId: productSpecs.productId, n: sql<number>`count(*)` }).from(productSpecs).where(inArray(productSpecs.productId, ids)).groupBy(productSpecs.productId),
    db.select({ productId: productImages.productId, n: sql<number>`count(*)` }).from(productImages).where(and(inArray(productImages.productId, ids), eq(productImages.kind, "clean"))).groupBy(productImages.productId),
    db.select({ productId: requestLines.productId, n: sql<number>`count(*)` }).from(requestLines).where(and(inArray(requestLines.productId, ids), isNull(requestLines.deletedAt))).groupBy(requestLines.productId),
    db.select({ productId: orderLines.productId, n: sql<number>`count(distinct ${orderLines.orderId})` }).from(orderLines).where(inArray(orderLines.productId, ids)).groupBy(orderLines.productId),
  ]);
  const cnt = (list: { productId: string | null; n: number }[]) => new Map(list.map((x) => [x.productId ?? "", Number(x.n)]));
  const sc = cnt(specs), ic = cnt(imgs), lc = cnt(lines), oc = cnt(ols);
  const t = today();
  const soon = new Date(now().getTime() + 30 * 86_400_000).toISOString().slice(0, 10);
  const q = f.q?.trim().toLowerCase();
  return rows
    .map(({ p, ownerOrgName }) => ({
      id: p.id, ref: p.ref, name: p.name, category: p.category, unit: p.unit, visibility: p.visibility, ownerOrgName,
      referencePriceMinorE2: p.referencePriceMinorE2, referenceCurrency: p.referenceCurrency ?? "USD", referenceMoq: p.referenceMoq, referenceIncoterm: p.referenceIncoterm, referencePort: p.referencePort,
      referenceSpecVersion: p.referenceSpecVersion, referenceValidUntil: p.referenceValidUntil,
      priceStale: !!p.referenceValidUntil && p.referenceValidUntil < t, priceExpiring: !!p.referenceValidUntil && p.referenceValidUntil >= t && p.referenceValidUntil <= soon,
      specVersions: sc.get(p.id) ?? 0, cleanImages: ic.get(p.id) ?? 0, image: thumbs.get(p.id) ?? null, linesCount: lc.get(p.id) ?? 0, ordersCount: oc.get(p.id) ?? 0,
      publishedAt: p.publishedAt?.toISOString() ?? null, updatedAt: p.updatedAt?.toISOString() ?? null,
    }) satisfies ProductRow)
    .filter((r) => {
      if (f.visibility && r.visibility !== f.visibility) return false;
      if (f.category && r.category !== f.category) return false;
      if (f.ownerOrgId && rows.find((x) => x.p.id === r.id)?.p.ownerOrgId !== f.ownerOrgId) return false;
      if (f.expiring && !(r.priceStale || r.priceExpiring)) return false;
      if (q && !`${r.ref} ${r.name} ${r.category ?? ""} ${r.ownerOrgName ?? ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
}

export async function clientOrgOptions(ctx: Ctx): Promise<{ id: string; name: string }[]> {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const db = await getDb();
  return db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(and(eq(organizations.type, "client"), isNull(organizations.deletedAt))).orderBy(organizations.name);
}

/* ───────────────────────── detail ───────────────────────── */

export type ProductImage = { id: string; kind: ImageKind; url: string; filename: string; bytes: number; exifStripped: boolean; approvedByName: string | null; createdAt: string };
export type ProductDetail = {
  id: string; ref: string; name: string; category: string | null; description: string | null; hsCode: string | null; unit: string; visibility: ProductVisibility;
  ownerOrgId: string | null; ownerOrgName: string | null;
  referencePriceMinorE2: number | null; referenceCurrency: string; referenceMoq: number | null; referenceIncoterm: string | null; referencePort: string | null; referenceSpecVersion: number | null; referenceValidUntil: string | null;
  priceStale: boolean; publishedAt: string | null; createdAt: string; updatedAt: string;
  specs: { id: string; version: number; fields: Record<string, string | number | boolean>; frozenAt: string | null; frozenByName: string | null }[];
  images: ProductImage[];
  lines: { id: string; lineRef: string; requestRef: string; orgName: string; state: LineState; qty: number | null; unit: string; specVersion: number | null; fromCatalog: boolean; createdAt: string }[];
  orders: { orderId: string; orderRef: string; orgName: string; state: LineState; qty: number; unit: string; unitPriceMinorE2: number; currency: string; supplierName: string | null; supplierRef: string | null; confirmedAt: string | null; deliveredAt: string | null }[];
  publishBlockers: string[];
};

export async function getProduct(ctx: Ctx, ref: string): Promise<ProductDetail> {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const db = await getDb();
  const [row] = await db.select({ p: products, ownerOrgName: organizations.name }).from(products).leftJoin(organizations, eq(organizations.id, products.ownerOrgId)).where(and(eq(products.ref, ref), isNull(products.deletedAt))).limit(1);
  if (!row) throw new NotFound("product");
  const p = row.p;
  const [specs, imgs, lines, ols] = await Promise.all([
    db.select().from(productSpecs).where(eq(productSpecs.productId, p.id)).orderBy(desc(productSpecs.version)),
    db.select({ i: productImages, f: files }).from(productImages).innerJoin(files, eq(files.id, productImages.fileId)).where(eq(productImages.productId, p.id)).orderBy(productImages.createdAt),
    db.select({ l: requestLines, requestRef: requests.ref, orgName: organizations.name }).from(requestLines).innerJoin(requests, eq(requests.id, requestLines.requestId)).innerJoin(organizations, eq(organizations.id, requestLines.orgId)).where(and(eq(requestLines.productId, p.id), isNull(requestLines.deletedAt))).orderBy(desc(requestLines.createdAt)),
    db.select({ ol: orderLines, o: orders, orgName: organizations.name }).from(orderLines).innerJoin(orders, eq(orders.id, orderLines.orderId)).innerJoin(organizations, eq(organizations.id, orders.orgId)).where(and(eq(orderLines.productId, p.id), isNull(orders.deletedAt))).orderBy(desc(orders.createdAt)),
  ]);
  const partIds = ols.map((r) => r.ol.participationId).filter((x): x is NonNullable<typeof x> => !!x) as string[];
  const partRows = partIds.length
    ? await db.select({ id: supplierParticipations.id, ref: suppliers.ref, name: suppliers.legalName }).from(supplierParticipations).innerJoin(suppliers, eq(suppliers.id, supplierParticipations.supplierId)).where(inArray(supplierParticipations.id, partIds))
    : [];
  const partBy = new Map(partRows.map((r) => [r.id, r]));
  const names = await userNames(db, [...specs.map((s) => s.frozenBy), ...imgs.map((i) => i.i.approvedBy)].filter((x): x is string => !!x));
  const cleanCount = imgs.filter((i) => i.i.kind === "clean").length;
  const blockers: string[] = [];
  if (p.referencePriceMinorE2 == null) blockers.push("reference price");
  if (p.referenceMoq == null) blockers.push("MOQ");
  if (!p.referenceIncoterm) blockers.push("incoterm");
  if (!p.referencePort) blockers.push("port");
  if (p.referenceSpecVersion == null) blockers.push("spec version");
  if (!p.referenceValidUntil) blockers.push("valid until");
  if (!cleanCount) blockers.push("clean image");
  return {
    id: p.id, ref: p.ref, name: p.name, category: p.category, description: p.description, hsCode: p.hsCode, unit: p.unit, visibility: p.visibility, ownerOrgId: p.ownerOrgId, ownerOrgName: row.ownerOrgName,
    referencePriceMinorE2: p.referencePriceMinorE2, referenceCurrency: p.referenceCurrency ?? "USD", referenceMoq: p.referenceMoq, referenceIncoterm: p.referenceIncoterm, referencePort: p.referencePort, referenceSpecVersion: p.referenceSpecVersion, referenceValidUntil: p.referenceValidUntil,
    priceStale: !!p.referenceValidUntil && p.referenceValidUntil < today(), publishedAt: p.publishedAt?.toISOString() ?? null, createdAt: p.createdAt.toISOString(), updatedAt: p.updatedAt.toISOString(),
    specs: specs.map((s) => ({ id: s.id, version: s.version, fields: s.fields, frozenAt: s.frozenAt?.toISOString() ?? null, frozenByName: s.frozenBy ? names[s.frozenBy] ?? null : null })),
    images: imgs.map(({ i, f }) => ({ id: i.id, kind: i.kind, url: `/api/files/${f.storageKey}`, filename: f.originalName, bytes: f.bytes, exifStripped: f.exifStripped, approvedByName: i.approvedBy ? names[i.approvedBy] ?? null : null, createdAt: i.createdAt.toISOString() })),
    lines: lines.map(({ l, requestRef, orgName }) => ({ id: l.id, lineRef: l.lineRef, requestRef, orgName, state: l.state, qty: l.qtyFirst, unit: l.unit, specVersion: l.specVersion, fromCatalog: l.fromCatalog, createdAt: l.createdAt.toISOString() })),
    orders: ols.map(({ ol, o, orgName }) => {
      const part = ol.participationId ? partBy.get(ol.participationId as unknown as string) : null;
      return { orderId: o.id, orderRef: o.ref, orgName, state: o.state, qty: ol.qty, unit: ol.unit, unitPriceMinorE2: ol.unitPriceMinorE2, currency: o.currency, supplierName: part?.name ?? null, supplierRef: part?.ref ?? null, confirmedAt: o.confirmedAt?.toISOString() ?? null, deliveredAt: o.deliveredAt?.toISOString() ?? null };
    }),
    publishBlockers: blockers,
  };
}

/* ───────────────────────── mutations ───────────────────────── */

export type ProductInput = { name: string; category?: string | null; description?: string | null; hsCode?: string | null; unit?: string; ownerOrgId?: string | null };
export type ReferencePriceInput = { referencePriceMinorE2: number | null; referenceMoq: number | null; referenceIncoterm: string | null; referencePort: string | null; referenceSpecVersion: number | null; referenceValidUntil: string | null };

const clean = (v: string | null | undefined) => { const t = v?.trim(); return t ? t : null; };

export async function createProduct(ctx: Ctx, input: ProductInput): Promise<{ id: string; ref: string }> {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const db = await getDb();
  const ref = await nextRef(db, "PRD");
  const id = uuidv7();
  const at = now();
  await db.transaction(async (tx) => {
    await tx.insert(products).values({ id, ref, ownerOrgId: input.ownerOrgId ?? null, name: input.name.trim(), category: clean(input.category), description: clean(input.description), hsCode: clean(input.hsCode), unit: clean(input.unit) ?? "pcs", visibility: "private", referenceCurrency: "USD", createdBy: ctx.userId, createdAt: at, updatedAt: at });
    await tx.insert(productSpecs).values({ id: uuidv7(), productId: id, version: 1, fields: {}, createdAt: at });
    await logActivity(tx, { orgId: input.ownerOrgId ?? ctx.orgId, entityType: "product", entityId: id, type: "product_created", actorId: ctx.userId, actorName: ctx.name, visibility: "internal", at, payload: { text: `Product ${ref} created`, ref, name: input.name.trim() } });
  });
  return { id, ref };
}

export async function updateProduct(ctx: Ctx, id: string, input: ProductInput & Partial<ReferencePriceInput>): Promise<{ ref: string }> {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const db = await getDb();
  const [p] = await db.select().from(products).where(and(eq(products.id, id), isNull(products.deletedAt))).limit(1);
  if (!p) throw new NotFound("product");
  const at = now();
  const patch: Partial<typeof products.$inferInsert> = {
    name: input.name.trim(), category: clean(input.category), description: clean(input.description), hsCode: clean(input.hsCode), unit: clean(input.unit) ?? p.unit, ownerOrgId: input.ownerOrgId === undefined ? p.ownerOrgId : input.ownerOrgId, updatedAt: at,
  };
  if ("referencePriceMinorE2" in input) {
    Object.assign(patch, {
      referencePriceMinorE2: input.referencePriceMinorE2 ?? null, referenceMoq: input.referenceMoq ?? null, referenceIncoterm: clean(input.referenceIncoterm), referencePort: clean(input.referencePort),
      referenceSpecVersion: input.referenceSpecVersion ?? null, referenceValidUntil: clean(input.referenceValidUntil), referenceCurrency: "USD",
    });
  }
  if (p.visibility === "catalog") {
    // a published product's client-visible text is re-checked on every edit
    assertClean({ fields: { name: patch.name ?? null, description: patch.description ?? null } }, await loadLeakSources(db));
  }
  await db.transaction(async (tx) => {
    await tx.update(products).set(patch).where(eq(products.id, id));
    await logActivity(tx, { orgId: p.ownerOrgId ?? ctx.orgId, entityType: "product", entityId: id, type: "product_updated", actorId: ctx.userId, actorName: ctx.name, visibility: "internal", at, payload: { text: `Product ${p.ref} updated`, ref: p.ref, changed: Object.keys(input) } });
  });
  return { ref: p.ref };
}

/**
 * Publish to catalog (admin, SPEC F-24): all five reference attributes + valid-until, ≥1 clean image unless
 * `withoutImage`, leak check on name + description, `published_at`, `product_published` (internal).
 */
export async function publishProduct(ctx: Ctx, id: string, opts: { withoutImage?: boolean } & Partial<ReferencePriceInput> = {}): Promise<{ ref: string }> {
  if (!isAdmin(ctx)) throw new Forbidden("admin only");
  const db = await getDb();
  const [p] = await db.select().from(products).where(and(eq(products.id, id), isNull(products.deletedAt))).limit(1);
  if (!p) throw new NotFound("product");
  const next = {
    referencePriceMinorE2: opts.referencePriceMinorE2 ?? p.referencePriceMinorE2, referenceMoq: opts.referenceMoq ?? p.referenceMoq, referenceIncoterm: clean(opts.referenceIncoterm) ?? p.referenceIncoterm,
    referencePort: clean(opts.referencePort) ?? p.referencePort, referenceSpecVersion: opts.referenceSpecVersion ?? p.referenceSpecVersion, referenceValidUntil: clean(opts.referenceValidUntil) ?? p.referenceValidUntil,
  };
  const missing: Record<string, string> = {};
  if (next.referencePriceMinorE2 == null || next.referencePriceMinorE2 <= 0) missing.referencePrice = "Reference price is required";
  if (next.referenceMoq == null || next.referenceMoq <= 0) missing.referenceMoq = "MOQ is required";
  if (!next.referenceIncoterm) missing.referenceIncoterm = "Incoterm is required";
  if (!next.referencePort) missing.referencePort = "Port is required";
  if (next.referenceSpecVersion == null) missing.referenceSpecVersion = "Spec version is required";
  if (!next.referenceValidUntil) missing.referenceValidUntil = "Valid-until date is required";
  else if (next.referenceValidUntil < today()) missing.referenceValidUntil = "Valid-until must be in the future";
  if (next.referenceSpecVersion != null) {
    const [spec] = await db.select({ id: productSpecs.id }).from(productSpecs).where(and(eq(productSpecs.productId, id), eq(productSpecs.version, next.referenceSpecVersion))).limit(1);
    if (!spec) missing.referenceSpecVersion = `Spec v${next.referenceSpecVersion} does not exist`;
  }
  const [clean1] = await db.select({ id: productImages.id }).from(productImages).where(and(eq(productImages.productId, id), eq(productImages.kind, "clean"))).limit(1);
  if (!clean1 && !opts.withoutImage) missing.image = "Add a clean image or tick “publish without image”";
  if (Object.keys(missing).length) throw new ProductPublishError(missing);
  assertClean({ fields: { name: p.name, description: p.description } }, await loadLeakSources(db));
  const at = now();
  await db.transaction(async (tx) => {
    await tx.update(products).set({ ...next, referenceCurrency: "USD", visibility: "catalog", publishedAt: at, updatedAt: at }).where(eq(products.id, id));
    await logActivity(tx, { orgId: p.ownerOrgId ?? ctx.orgId, entityType: "product", entityId: id, type: "product_published", actorId: ctx.userId, actorName: ctx.name, visibility: "internal", at, payload: { ref: p.ref, name: p.name, referencePriceMinorE2: next.referencePriceMinorE2, referenceMoq: next.referenceMoq, incoterm: next.referenceIncoterm, port: next.referencePort, specVersion: next.referenceSpecVersion, validUntil: next.referenceValidUntil, withoutImage: !clean1 } });
  });
  return { ref: p.ref };
}

export class ProductPublishError extends Error {
  code = "E_PUBLISH_INCOMPLETE" as const;
  status = 422;
  constructor(public errors: Record<string, string>) { super(`E_PUBLISH_INCOMPLETE: ${Object.keys(errors).join(", ")}`); }
}

export async function unpublishProduct(ctx: Ctx, id: string): Promise<{ ref: string }> {
  if (!isAdmin(ctx)) throw new Forbidden("admin only");
  const db = await getDb();
  const [p] = await db.select().from(products).where(and(eq(products.id, id), isNull(products.deletedAt))).limit(1);
  if (!p) throw new NotFound("product");
  const at = now();
  await db.transaction(async (tx) => {
    await tx.update(products).set({ visibility: "private", updatedAt: at }).where(eq(products.id, id));
    await logActivity(tx, { orgId: p.ownerOrgId ?? ctx.orgId, entityType: "product", entityId: id, type: "product_unpublished", actorId: ctx.userId, actorName: ctx.name, visibility: "internal", at, payload: { text: `Product ${p.ref} unpublished`, ref: p.ref } });
  });
  return { ref: p.ref };
}

/** Upload an image of a kind. `clean` images live under the agency org `/client/` prefix so every signed-in client can load them. */
export async function uploadProductImage(ctx: Ctx, p: { productId: string; kind: ImageKind; data: Buffer; mime: string; filename: string }): Promise<{ imageId: string }> {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const db = await getDb();
  const [prod] = await db.select().from(products).where(and(eq(products.id, p.productId), isNull(products.deletedAt))).limit(1);
  if (!prod) throw new NotFound("product");
  if (!/^image\/(jpeg|png|webp)$/.test(p.mime)) throw new Forbidden("images only (png, jpg, webp)");
  if (p.kind === "clean") assertClean({ filenames: [p.filename] }, await loadLeakSources(db));
  const at = now();
  return db.transaction(async (tx) => {
    const f = await storeUpload(tx, { orgId: p.kind === "clean" ? ctx.orgId : prod.ownerOrgId ?? ctx.orgId, userId: ctx.userId, data: p.data, mime: p.mime, originalName: p.filename, entity: "product", entityId: prod.id, visibility: p.kind === "clean" ? "client" : "internal", at });
    const imageId = uuidv7();
    await tx.insert(productImages).values({ id: imageId, productId: prod.id, fileId: f.id, kind: p.kind, approvedBy: p.kind === "clean" ? ctx.userId : null, createdAt: at });
    await logActivity(tx, { orgId: prod.ownerOrgId ?? ctx.orgId, entityType: "product", entityId: prod.id, type: "product_image_added", actorId: ctx.userId, actorName: ctx.name, visibility: "internal", at, payload: { text: `Image added (${p.kind})`, ref: prod.ref, kind: p.kind, filename: p.filename } });
    return { imageId };
  });
}

/**
 * "Mark as clean / approve": copies the file to the agency `/client/` prefix as a new files row (EXIF already stripped
 * on upload) and inserts a `clean` image row; the original keeps its kind (supplier_facing stays supplier_facing, SPEC F-24).
 */
export async function approveImageAsClean(ctx: Ctx, imageId: string): Promise<{ imageId: string }> {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const db = await getDb();
  const [row] = await db.select({ i: productImages, f: files, p: products }).from(productImages).innerJoin(files, eq(files.id, productImages.fileId)).innerJoin(products, eq(products.id, productImages.productId)).where(eq(productImages.id, imageId)).limit(1);
  if (!row) throw new NotFound("image");
  if (row.i.kind === "clean") return { imageId };
  if (!row.f.exifStripped) throw new Forbidden("image metadata was not stripped; re-upload it");
  assertClean({ filenames: [row.f.originalName] }, await loadLeakSources(db));
  const { getStorage } = await import("@/server/shared/storage");
  const obj = await getStorage().get(row.f.storageKey);
  if (!obj) throw new NotFound("file");
  const chunks: Buffer[] = [];
  for await (const c of obj.body as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(c));
  const at = now();
  return db.transaction(async (tx) => {
    const f = await storeUpload(tx, { orgId: ctx.orgId, userId: ctx.userId, data: Buffer.concat(chunks), mime: row.f.mime, originalName: row.f.originalName, entity: "product", entityId: row.p.id, visibility: "client", at });
    const newId = uuidv7();
    await tx.insert(productImages).values({ id: newId, productId: row.p.id, fileId: f.id, kind: "clean", approvedBy: ctx.userId, createdAt: at });
    await logActivity(tx, { orgId: row.p.ownerOrgId ?? ctx.orgId, entityType: "product", entityId: row.p.id, type: "image_approved_clean", actorId: ctx.userId, actorName: ctx.name, visibility: "internal", at, payload: { text: "Image approved as clean", ref: row.p.ref, fromImageId: imageId, imageId: newId } });
    return { imageId: newId };
  });
}

export async function removeImage(ctx: Ctx, imageId: string): Promise<void> {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const db = await getDb();
  const [row] = await db.select({ i: productImages, p: products }).from(productImages).innerJoin(products, eq(products.id, productImages.productId)).where(eq(productImages.id, imageId)).limit(1);
  if (!row) throw new NotFound("image");
  if (row.i.kind === "clean" && row.p.visibility === "catalog") {
    const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(productImages).where(and(eq(productImages.productId, row.p.id), eq(productImages.kind, "clean")));
    if (Number(n) <= 1) throw new Forbidden("a published product keeps at least one clean image — unpublish first");
  }
  const at = now();
  await db.transaction(async (tx) => {
    await tx.delete(productImages).where(eq(productImages.id, imageId));
    await logActivity(tx, { orgId: row.p.ownerOrgId ?? ctx.orgId, entityType: "product", entityId: row.p.id, type: "product_image_removed", actorId: ctx.userId, actorName: ctx.name, visibility: "internal", at, payload: { text: `Image removed (${row.i.kind})`, ref: row.p.ref, kind: row.i.kind } });
  });
}
