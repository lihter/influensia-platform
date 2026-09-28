/**
 * Client catalog (SPEC F-11, D-16). Reads the app schema only. Only `product_images.kind = clean` rows with
 * `files.exif_stripped` under a `/client/` key are ever mapped; `owner_org_id` never leaves this module.
 * "Request offer" creates a request with one pre-linked line in `submitted` (via transition()).
 */
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { getDb } from "@/db";
import { products, productSpecs, productImages, files, requests, requestLines, orders, orderLines } from "@/db/schema/app";
import { type Ctx, isClient, Forbidden, NotFound } from "@/server/shared/authorize";
import { logActivity } from "@/server/shared/activity";
import { enqueue } from "@/server/shared/outbox";
import { defaultAgentFor } from "@/server/shared/default-agent";
import { transition } from "@/server/shared/transition";
import { nextRef, lineRef as mkLineRef } from "@/server/shared/ids";
import { now, today } from "@/server/shared/clock";
import { ClientCatalogDto, ClientCatalogProductDto, ClientProductImageDto, ClientPreviousOrderDto, ClientSpecFieldDto } from "./dto";
import { ClientCatalogRequestDto, ClientCatalogCategoryDto } from "./dto/catalog";
import { specKeyLabel, specValueLabel } from "@/lib/labels";

type ImageRow = { productId: string; id: string; storageKey: string; exifStripped: boolean; createdAt: Date };

/** Clean images only, EXIF-stripped, served from a `/client/` key (SPEC 5.6). */
async function cleanImages(productIds: string[]): Promise<Map<string, ImageRow[]>> {
  const out = new Map<string, ImageRow[]>();
  if (!productIds.length) return out;
  const db = await getDb();
  const rows = await db
    .select({ productId: productImages.productId, id: productImages.id, storageKey: files.storageKey, exifStripped: files.exifStripped, createdAt: productImages.createdAt })
    .from(productImages).innerJoin(files, eq(files.id, productImages.fileId))
    .where(and(inArray(productImages.productId, productIds), eq(productImages.kind, "clean"), eq(files.exifStripped, true)))
    .orderBy(asc(productImages.createdAt));
  for (const r of rows) {
    if (!r.storageKey.includes("/client/")) continue;
    out.set(r.productId, [...(out.get(r.productId) ?? []), r]);
  }
  return out;
}

const imageDto = (r: ImageRow) => ClientProductImageDto.parse({ id: r.id, url: `/api/files/${r.storageKey}` });

async function orderedProductIds(orgId: string): Promise<Set<string>> {
  const db = await getDb();
  const rows = await db.select({ productId: orderLines.productId }).from(orderLines).innerJoin(orders, eq(orders.id, orderLines.orderId)).where(and(eq(orders.orgId, orgId), isNull(orders.deletedAt)));
  return new Set(rows.map((r) => r.productId).filter((x): x is string => !!x));
}

function card(p: typeof products.$inferSelect, image: ImageRow | undefined, ordered: Set<string>): ClientCatalogDto {
  const t = today();
  return ClientCatalogDto.parse({
    id: p.id, ref: p.ref, name: p.name, category: p.category, unit: p.unit,
    image: image ? imageDto(image) : null,
    referencePrice: p.referencePriceMinorE2 != null ? { minorE2: p.referencePriceMinorE2, currency: p.referenceCurrency ?? "USD", unit: p.unit } : null,
    referenceMoq: p.referenceMoq, referenceIncoterm: p.referenceIncoterm, referencePort: p.referencePort, referenceSpecVersion: p.referenceSpecVersion, referenceValidUntil: p.referenceValidUntil,
    priceStale: !p.referenceValidUntil || p.referenceValidUntil < t,
    orderedBefore: ordered.has(p.id),
  });
}

export async function listCatalog(ctx: Ctx): Promise<{ products: ClientCatalogDto[]; categories: ClientCatalogCategoryDto[] }> {
  if (!isClient(ctx)) throw new Forbidden("clients only");
  const db = await getDb();
  const rows = await db.select().from(products).where(and(eq(products.visibility, "catalog"), isNull(products.deletedAt))).orderBy(products.ref);
  const [imgs, ordered] = await Promise.all([cleanImages(rows.map((r) => r.id)), orderedProductIds(ctx.orgId)]);
  const list = rows.map((p) => card(p, imgs.get(p.id)?.[0], ordered));
  const counts = new Map<string, number>();
  for (const p of list) if (p.category) counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
  const categories = [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([category, count]) => ClientCatalogCategoryDto.parse({ category, count }));
  return { products: list, categories };
}

export async function getCatalogProduct(ctx: Ctx, ref: string): Promise<ClientCatalogProductDto> {
  if (!isClient(ctx)) throw new Forbidden("clients only");
  const db = await getDb();
  const [p] = await db.select().from(products).where(and(eq(products.ref, ref), eq(products.visibility, "catalog"), isNull(products.deletedAt))).limit(1);
  if (!p) throw new NotFound("product");
  const [imgs, ordered, spec, prev] = await Promise.all([
    cleanImages([p.id]),
    orderedProductIds(ctx.orgId),
    p.referenceSpecVersion != null ? db.select().from(productSpecs).where(and(eq(productSpecs.productId, p.id), eq(productSpecs.version, p.referenceSpecVersion))).limit(1) : Promise.resolve([]),
    db.select({ ol: orderLines, o: orders }).from(orderLines).innerJoin(orders, eq(orders.id, orderLines.orderId)).where(and(eq(orderLines.productId, p.id), eq(orders.orgId, ctx.orgId), isNull(orders.deletedAt))).orderBy(desc(orders.createdAt)),
  ]);
  const base = card(p, imgs.get(p.id)?.[0], ordered);
  return ClientCatalogProductDto.parse({
    ...base,
    description: p.description,
    images: (imgs.get(p.id) ?? []).map(imageDto),
    spec: Object.entries(spec[0]?.fields ?? {}).map(([key, value]) => ClientSpecFieldDto.parse({ key: specKeyLabel(key), value: specValueLabel(value) })),
    previousOrders: prev.map(({ ol, o }) => ClientPreviousOrderDto.parse({ orderRef: o.ref, qty: ol.qty, unit: ol.unit, unitPrice: { minorE2: ol.unitPriceMinorE2, currency: o.currency, unit: ol.unit }, fee: ol.feeMinor ? { minor: ol.feeMinor, currency: o.currency } : null, deliveredAt: o.deliveredAt?.toISOString() ?? null })),
  });
}

/**
 * "Request offer" (F-11): request `source=portal`, note "From catalog PRD-0001", one line pre-linked to the product
 * (`product_id`, name, `spec_version = reference_spec_version`, qty, `from_catalog = true`) moved to `submitted`
 * through transition() so the request roll-up, `state_changed` and `ops_new_request` happen exactly as for any request.
 */
export async function requestOffer(ctx: Ctx, input: { productRef: string; qty: number; note?: string | null }): Promise<ClientCatalogRequestDto> {
  if (!isClient(ctx)) throw new Forbidden("clients only");
  const db = await getDb();
  const [p] = await db.select().from(products).where(and(eq(products.ref, input.productRef), eq(products.visibility, "catalog"), isNull(products.deletedAt))).limit(1);
  if (!p) throw new NotFound("product");
  const at = now();
  const requestRef = await nextRef(db, "REQ", at.getUTCFullYear());
  const requestId = uuidv7();
  const lineId = uuidv7();
  const lineRefValue = mkLineRef(requestRef, 1);
  const userNote = input.note?.trim() || null;
  const note = [`From catalog ${p.ref}`, userNote].filter(Boolean).join(" — ");
  await db.transaction(async (tx) => {
    await tx.insert(requests).values({ id: requestId, ref: requestRef, orgId: ctx.orgId, source: "portal", status: "draft", note, createdBy: ctx.userId, createdAt: at, updatedAt: at });
    await tx.insert(requestLines).values({
      id: lineId, requestId, orgId: ctx.orgId, lineNo: 1, lineRef: lineRefValue, productId: p.id, name: p.name, qtyFirst: input.qty, unit: p.unit, customisation: userNote,
      state: "draft", milestone: "received", specVersion: p.referenceSpecVersion, fromCatalog: true, sampleRequired: true, lastStateChangeAt: at, createdBy: ctx.userId, createdAt: at, updatedAt: at,
    });
    await logActivity(tx, { orgId: ctx.orgId, entityType: "request", entityId: requestId, type: "request_submitted", actorId: ctx.userId, actorName: ctx.name, visibility: "client", at, payload: { ref: requestRef, lines: 1, fromCatalog: true } });
    await logActivity(tx, { orgId: ctx.orgId, entityType: "request_line", entityId: lineId, type: "line_created", actorId: ctx.userId, actorName: ctx.name, visibility: "client", at, payload: { ref: lineRefValue, name: p.name, qty: input.qty, unit: p.unit, fromCatalog: true, productRef: p.ref, text: `Catalog request — ${p.name}` } });
    await transition(lineId, "submitted", ctx, { tx, at, payload: { fromCatalog: true } });
    // QA-10: a catalog request gets an owner straight away (the client's agent for this product, else their last agent)
    const agent = await defaultAgentFor(tx, { orgId: ctx.orgId, productId: p.id });
    if (agent) {
      await tx.update(requestLines).set({ assignedAgentId: agent.id, updatedAt: at }).where(eq(requestLines.id, lineId));
      await logActivity(tx, { orgId: ctx.orgId, entityType: "request_line", entityId: lineId, type: "line_assigned", actorId: null, actorName: "System", visibility: "internal", at: new Date(at.getTime() + 500), payload: { ref: lineRefValue, agentId: agent.id, agentName: agent.name, reason: "catalog request" } });
      await transition(lineId, "in_review", null, { tx, at: new Date(at.getTime() + 1000), payload: { agentName: agent.name } });
    }
    await enqueue({ userId: ctx.userId, toEmail: ctx.email, template: "client_request_received", subject: `We received your request ${requestRef}`, entityRef: requestRef, payload: { ref: requestRef, name: p.name, qty: input.qty, unit: p.unit, url: `/app/lines/${lineRefValue}` }, idempotencyKey: `client_request_received:${requestId}:${ctx.userId}`, at }, tx);
  });
  return ClientCatalogRequestDto.parse({ requestRef, lineRef: lineRefValue, productRef: p.ref, name: p.name, qty: input.qty, unit: p.unit });
}
