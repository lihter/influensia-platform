/**
 * Spec & freeze (SPEC F-15) and cost model & target price (F-16).
 * The working spec is a `product_specs` row with `frozen_at = null` (version = last frozen + 1); Freeze stamps it.
 */
import { ZodError } from "zod";
import { and, desc, eq, isNull } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { getDb, type DbOrTx } from "@/db";
import { requestLines, products, productSpecs, productImages, documents } from "@/db/schema/app";
import type { CostModel } from "@/db/types";
import { type Ctx, isOps, Forbidden, NotFound } from "@/server/shared/authorize";
import { logActivity } from "@/server/shared/activity";
import { transition } from "@/server/shared/transition";
import { nextRef } from "@/server/shared/ids";
import { now } from "@/server/shared/clock";
import { storeUpload } from "@/server/shared/files";
import { enqueue } from "@/server/shared/outbox";
import { clientUsersOf } from "@/server/shared/users";
import { lineById, pricingRuleFor } from "./participations";

export type SpecField = { key: string; value: string | number | boolean };
export type SaveSpecInput = {
  lineId: string;
  productName: string;
  category?: string | null;
  hsCode?: string | null;
  unit: string;
  materials?: string | null;
  customisation?: string | null;
  artworkRequired?: boolean;
  sampleRequired?: boolean;
  fields: SpecField[];
};

export { specCompleteness, summariseSpec, targetPriceE2, defaultEstE2 } from "@/components/ops/board/pure";
import { specCompleteness, summariseSpec, targetPriceE2 } from "@/components/ops/board/pure";

async function ensureProduct(tx: DbOrTx, ctx: Ctx, line: typeof requestLines.$inferSelect, input: { productName: string; category?: string | null; hsCode?: string | null; unit: string }, at: Date) {
  if (line.productId) {
    await tx.update(products).set({ name: input.productName, category: input.category ?? null, hsCode: input.hsCode ?? null, unit: input.unit, updatedAt: at }).where(eq(products.id, line.productId));
    return line.productId;
  }
  const id = uuidv7();
  const ref = await nextRef(tx as never, "PRD");
  await tx.insert(products).values({ id, ref, ownerOrgId: line.orgId, name: input.productName, category: input.category ?? null, hsCode: input.hsCode ?? null, unit: input.unit, visibility: "private", createdBy: ctx.userId, createdAt: at, updatedAt: at });
  await tx.update(requestLines).set({ productId: id, updatedAt: at }).where(eq(requestLines.id, line.id));
  return id;
}

async function upsertDraftSpec(tx: DbOrTx, productId: string, fields: Record<string, string | number | boolean>, at: Date) {
  const rows = await tx.select().from(productSpecs).where(eq(productSpecs.productId, productId)).orderBy(desc(productSpecs.version));
  const draft = rows.find((r) => !r.frozenAt);
  if (draft) { await tx.update(productSpecs).set({ fields }).where(eq(productSpecs.id, draft.id)); return draft; }
  const version = (rows[0]?.version ?? 0) + 1;
  const id = uuidv7();
  await tx.insert(productSpecs).values({ id, productId, version, fields, createdAt: at });
  return { id, productId, version, fields, frozenAt: null, frozenBy: null, createdAt: at };
}

const toFields = (fields: SpecField[]) => Object.fromEntries(fields.filter((f) => f.key.trim()).map((f) => [f.key.trim(), f.value]));

/** Save the working spec (no state change). Creates the product when the line has none. */
export async function saveSpec(ctx: Ctx, input: SaveSpecInput) {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const db = await getDb();
  const at = now();
  return db.transaction(async (tx) => {
    const line = await lineById(tx, input.lineId);
    const productId = await ensureProduct(tx, ctx, line, input, at);
    await tx.update(requestLines).set({ unit: input.unit, materials: input.materials ?? null, customisation: input.customisation ?? null, artworkRequired: input.artworkRequired ?? line.artworkRequired, sampleRequired: input.sampleRequired ?? line.sampleRequired, updatedAt: at }).where(eq(requestLines.id, line.id));
    const draft = await upsertDraftSpec(tx, productId, toFields(input.fields), at);
    await logActivity(tx, { orgId: line.orgId, entityType: "request_line", entityId: line.id, type: "line_updated", actorId: ctx.userId, actorName: ctx.name, visibility: "internal", at, payload: { ref: line.lineRef, text: `Spec draft v${draft.version} saved` } });
    return { lineRef: line.lineRef, version: draft.version };
  });
}

/** Freeze spec v{n}: completeness gate, product_specs frozen, line spec_version, → spec_frozen (auto-claim from submitted). */
export async function freezeSpec(ctx: Ctx, input: SaveSpecInput) {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const db = await getDb();
  const at = now();
  return db.transaction(async (tx) => {
    const line = await lineById(tx, input.lineId);
    const productId = await ensureProduct(tx, ctx, line, input, at);
    const fields = toFields(input.fields);
    const [imgs, refImgs] = await Promise.all([
      tx.select({ id: productImages.id }).from(productImages).where(eq(productImages.productId, productId)),
      tx.select({ id: documents.id }).from(documents).where(and(eq(documents.entityType, "request_line"), eq(documents.entityId, line.id), eq(documents.kind, "reference_image"), isNull(documents.deletedAt))),
    ]);
    const gate = specCompleteness({ name: input.productName, category: input.category ?? null, unit: input.unit, fieldCount: Object.keys(fields).length, imageCount: imgs.length + refImgs.length, linkCount: line.clientLinks.length, qty: line.qtyFirst });
    if (!gate.ok) { throw new ZodError([{ code: "custom", path: ["_"], message: `Missing: ${gate.missing.join(", ")}`, input: null } as never]); }
    const draft = await upsertDraftSpec(tx, productId, fields, at);
    await tx.update(productSpecs).set({ frozenAt: at, frozenBy: ctx.userId }).where(eq(productSpecs.id, draft.id));
    await tx.update(requestLines).set({ specVersion: draft.version, unit: input.unit, materials: input.materials ?? null, customisation: input.customisation ?? null, artworkRequired: input.artworkRequired ?? line.artworkRequired, sampleRequired: input.sampleRequired ?? line.sampleRequired, ...(line.state === "submitted" && !line.assignedAgentId ? { assignedAgentId: ctx.userId } : {}), updatedAt: at }).where(eq(requestLines.id, line.id));
    if (line.state === "submitted" && !line.assignedAgentId) await logActivity(tx, { orgId: line.orgId, entityType: "request_line", entityId: line.id, type: "line_assigned", actorId: ctx.userId, actorName: ctx.name, visibility: "internal", at, payload: { ref: line.lineRef, agentId: ctx.userId, agentName: ctx.name } });
    const summary = summariseSpec(fields);
    const first = line.state === "submitted" || line.state === "in_review";
    await logActivity(tx, { orgId: line.orgId, entityType: "request_line", entityId: line.id, type: "spec_frozen", actorId: ctx.userId, actorName: ctx.name, visibility: "client", at, payload: { ref: line.lineRef, version: draft.version, summary, text: first ? `Spec confirmed: ${summary} — Finding factory` : `Spec updated to v${draft.version}: ${summary}` } });
    if (first) await transition(line.id, "spec_frozen", ctx, { tx, at });
    else for (const u of await clientUsersOf(tx, line.orgId)) await enqueue({ userId: u.id, toEmail: u.email, template: "client_new_update", entityRef: line.lineRef, subject: `Update on ${line.name}`, payload: { ref: line.lineRef, name: line.name, url: `/app/lines/${line.lineRef}`, text: `Spec updated to v${draft.version}` }, idempotencyKey: `client_new_update:${line.id}:spec-v${draft.version}:${u.id}`, at }, tx);
    return { lineRef: line.lineRef, version: draft.version };
  });
}

/** Supplier-facing image upload → product_images kind supplier_facing (internal storage). Creates the product if needed. */
export async function uploadSupplierFacingImage(ctx: Ctx, input: { lineId: string; data: Buffer; mime: string; filename: string; kind?: "supplier_facing" | "clean" }) {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const db = await getDb();
  const at = now();
  return db.transaction(async (tx) => {
    const line = await lineById(tx, input.lineId);
    const productId = await ensureProduct(tx, ctx, line, { productName: line.name, unit: line.unit }, at);
    const kind = input.kind ?? "supplier_facing";
    const f = await storeUpload(tx, { orgId: line.orgId, userId: ctx.userId, data: input.data, mime: input.mime, originalName: input.filename, entity: "product", entityId: productId, visibility: kind === "clean" ? "client" : "internal", at });
    await tx.insert(productImages).values({ id: uuidv7(), productId, fileId: f.id, kind, createdAt: at });
    await logActivity(tx, { orgId: line.orgId, entityType: "request_line", entityId: line.id, type: "document_uploaded", actorId: ctx.userId, actorName: ctx.name, visibility: "internal", at, payload: { ref: line.lineRef, filename: input.filename, kind: `image:${kind}` } });
    return { lineRef: line.lineRef };
  });
}

/* ───────────────────────── cost model & target (F-16) ───────────────────────── */

export type CostModelInput = {
  lineId: string;
  materialFloorMinorE2?: number | null;
  processCostMinorE2?: number | null;
  packagingMinorE2?: number | null;
  overheadPct?: number | null;
  estProdCostMinorE2: number;
  method?: string | null;
  notes?: string | null;
  upliftPct: number;
};


/** Save cost model + uplift → target; first save moves spec_frozen → cost_target_price. Never client-visible. */
export async function saveCostModel(ctx: Ctx, input: CostModelInput) {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  if (!(input.estProdCostMinorE2 > 0)) { throw new ZodError([{ code: "custom", path: ["estProdCostMinorE2"], message: "Estimated production cost must be > 0", input: input.estProdCostMinorE2 } as never]); }
  const db = await getDb();
  const at = now();
  return db.transaction(async (tx) => {
    const line = await lineById(tx, input.lineId);
    const model: CostModel = {
      material_floor_minor_e2: input.materialFloorMinorE2 ?? undefined, process_cost_minor_e2: input.processCostMinorE2 ?? undefined, packaging_minor_e2: input.packagingMinorE2 ?? undefined,
      overhead_pct: input.overheadPct ?? undefined, est_prod_cost_minor_e2: input.estProdCostMinorE2, method: input.method ?? undefined, notes: input.notes ?? undefined,
    };
    const target = targetPriceE2(input.estProdCostMinorE2, input.upliftPct);
    await tx.update(requestLines).set({ costModel: model, upliftPct: input.upliftPct, targetPriceMinorE2: target, updatedAt: at }).where(eq(requestLines.id, line.id));
    await logActivity(tx, { orgId: line.orgId, entityType: "request_line", entityId: line.id, type: "cost_model_saved", actorId: ctx.userId, actorName: ctx.name, visibility: "internal", at, payload: { ref: line.lineRef, est: input.estProdCostMinorE2 / 10000, uplift: input.upliftPct, target: target / 10000 } });
    if (line.state === "spec_frozen") await transition(line.id, "cost_target_price", ctx, { tx, at });
    return { lineRef: line.lineRef, targetPriceMinorE2: target };
  });
}

export async function confirmTarget(ctx: Ctx, input: { lineId: string }) {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const db = await getDb();
  const at = now();
  return db.transaction(async (tx) => {
    const line = await lineById(tx, input.lineId);
    if (!line.targetPriceMinorE2) throw new NotFound("target price");
    await tx.update(requestLines).set({ targetConfirmedBy: ctx.userId, targetConfirmedAt: at, updatedAt: at }).where(eq(requestLines.id, line.id));
    await logActivity(tx, { orgId: line.orgId, entityType: "request_line", entityId: line.id, type: "target_confirmed", actorId: ctx.userId, actorName: ctx.name, visibility: "internal", at, payload: { ref: line.lineRef, target: line.targetPriceMinorE2 / 10000 } });
    return { lineRef: line.lineRef };
  });
}

export async function defaultUplift(category: string | null | undefined) {
  const db = await getDb();
  return (await pricingRuleFor(db, category)).upliftPct;
}
