/**
 * Client line page (SPEC F-07). App schema only; supplier facts arrive as numbers (`sourcingCounts`) or a label
 * (`factoryLabelForLine`). Every shape is built field-by-field and parsed through a `.strict()` DTO.
 */
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { getDb, type DbOrTx } from "@/db";
import { requestLines, organizations, users, offers, offerOptions, samples, orders, orderLines, documents, files, comments, activityEvents, productSpecs } from "@/db/schema/app";
import { INTERNAL_ONLY_DOCUMENT_KINDS, type DocumentKind, type EntityType } from "@/db/enums";
import type { PriceBreak } from "@/db/types";
import { type Ctx, isClient, Forbidden, NotFound } from "@/server/shared/authorize";
import { loadLineContexts, type LineContext } from "@/server/shared/line-context";
import { factoryLabelForLine } from "@/server/shared/sourcing-counts";
import { milestoneStep, isActionMilestone, isBeforeOrder, MILESTONES } from "@/server/shared/state-machine";
import { subLabelFor, exceptionClientText, eventText, isFeedEvent, MILESTONE_EVENT_TYPES } from "@/server/shared/labels";
import { clientWaitingReason, etaLabelFor } from "./dashboard";
import { clientDownloadUrl } from "./documents";
import { lineExtras, milestoneDatesFor, specFieldsFor } from "./line-extras";
import { collapseClientUpdates, collapseClientHistory } from "@/server/shared/timeline";
import { ClientRequestLineDto, ClientDocumentDto, ClientUpdateDto, ClientEventDto, ClientTimelineDto, ClientPreviousOrderDto, type ClientDocumentDto as ClientDocument } from "./dto";
import { ClientLinePageDto, ClientLineOfferCardDto, ClientLineSampleCardDto, ClientLineOrderCardDto } from "./dto/lines";

export const unitPriceAtQty = (breaks: PriceBreak[] | null | undefined, qty: number | null): number | null => {
  if (!breaks?.length) return null;
  const sorted = [...breaks].sort((a, b) => a.min_qty - b.min_qty);
  const brk = qty ? [...sorted].reverse().find((b) => b.min_qty <= qty) ?? sorted[0] : sorted[0];
  return brk.unit_price_minor_e2;
};

const CLIENT_KINDS = new Set<DocumentKind>((["pi", "invoice", "qc_report", "bill_of_lading", "packing_list", "certificate", "artwork", "dieline", "reference_image", "production_photo", "sample_photo", "factory_range_pdf", "other"] as DocumentKind[]).filter((k) => !INTERNAL_ONLY_DOCUMENT_KINDS.includes(k)));

/** Client-visible documents of client kinds for a set of entities, mapped to the strict DTO. Storage keys stay server-side except inside the download URL. */
export async function clientDocuments(db: DbOrTx, orgId: string, entities: { entityType: EntityType; entityId: string }[]): Promise<ClientDocument[]> {
  if (!entities.length) return [];
  const rows = await db
    .select({ d: documents, f: files })
    .from(documents)
    .innerJoin(files, eq(files.id, documents.fileId))
    .where(and(eq(documents.orgId, orgId), eq(documents.visibility, "client"), isNull(documents.deletedAt), or(...entities.map((e) => and(eq(documents.entityType, e.entityType), eq(documents.entityId, e.entityId))))))
    .orderBy(desc(documents.createdAt));
  return rows
    .filter(({ d, f }) => CLIENT_KINDS.has(d.kind) && f.storageKey.includes("/client/") && (!f.mime.startsWith("image/") || f.exifStripped))
    .map(({ d, f }) => ClientDocumentDto.parse({ id: d.id, filename: d.filename, kind: d.kind, bytes: f.bytes, uploadedAt: d.createdAt.toISOString(), downloadUrl: clientDownloadUrl(f.storageKey, d.filename) }));
}

/** Loads a line by ref inside the caller's org, or 404. */
export async function clientLineContext(db: DbOrTx, ctx: Ctx, ref: string): Promise<LineContext> {
  const [row] = await db.select({ id: requestLines.id }).from(requestLines).where(and(eq(requestLines.lineRef, ref), eq(requestLines.orgId, ctx.orgId), isNull(requestLines.deletedAt))).limit(1);
  if (!row) throw new NotFound("line");
  const [lc] = await loadLineContexts(db, { orgId: ctx.orgId, lineIds: [row.id], includeCancelled: true, includeDrafts: true });
  if (!lc) throw new NotFound("line");
  return lc;
}

async function orgUserIds(db: DbOrTx, orgId: string) {
  return new Set((await db.select({ id: users.id }).from(users).where(eq(users.orgId, orgId))).map((u) => u.id));
}

/** Updates (curated feed) + History (every client-visible event) for a line and its order. */
export async function clientTimeline(db: DbOrTx, ctx: Ctx, lc: LineContext) {
  const entityConds = [and(eq(activityEvents.entityType, "request_line"), eq(activityEvents.entityId, lc.id))];
  if (lc.order) entityConds.push(and(eq(activityEvents.entityType, "order"), eq(activityEvents.entityId, lc.order.id)));
  const [eRows, cRows, mine] = await Promise.all([
    db.select().from(activityEvents).where(and(eq(activityEvents.orgId, ctx.orgId), eq(activityEvents.visibility, "client"), or(...entityConds))).orderBy(desc(activityEvents.createdAt)).limit(300),
    db.select().from(comments).where(and(eq(comments.orgId, ctx.orgId), eq(comments.entityType, "request_line"), eq(comments.entityId, lc.id), eq(comments.visibility, "client"), eq(comments.source, "app"), isNull(comments.deletedAt), sql`${comments.kind} <> 'note'`)).orderBy(desc(comments.createdAt)),
    orgUserIds(db, ctx.orgId),
  ]);
  const attachmentIds = cRows.flatMap((c) => c.attachments);
  const attachmentDocs = attachmentIds.length
    ? (await clientDocuments(db, ctx.orgId, [{ entityType: "request_line", entityId: lc.id }, ...(lc.sample ? [{ entityType: "sample" as const, entityId: lc.sample.id }] : [])])).filter((d) => attachmentIds.includes(d.id))
    : [];
  const history = eRows.map((e) => ClientEventDto.parse({
    id: e.id, type: e.type, text: eventText(e.type, e.payload), actorName: e.actorName, at: e.createdAt.toISOString(),
    isMilestone: (MILESTONE_EVENT_TYPES as readonly string[]).includes(e.type),
    isActionMilestone: typeof e.payload.milestone === "string" && isActionMilestone(e.payload.milestone as never) && e.payload.milestoneChanged === true,
  }));
  const seen = new Set<string>();
  const updates = [
    ...cRows.map((c) => ClientUpdateDto.parse({ id: c.id, kind: "comment", at: c.createdAt.toISOString(), text: c.body, authorName: c.authorName, byYou: !!c.authorId && mine.has(c.authorId), isActionMilestone: false, attachments: attachmentDocs.filter((d) => c.attachments.includes(d.id)) })),
    // Updates = comments + milestone-grade events; order-page details (documents, artwork) stay in History (SPEC 7.12)
    ...eRows.filter((e) => isFeedEvent(e.type, e.payload) && e.type !== "document_published" && e.type !== "artwork_decided").map((e) => ClientUpdateDto.parse({ id: e.id, kind: "event", at: e.createdAt.toISOString(), text: eventText(e.type, e.payload), authorName: e.actorName, byYou: !!e.actorId && mine.has(e.actorId), isActionMilestone: typeof e.payload.milestone === "string" && isActionMilestone(e.payload.milestone as never) && e.payload.milestoneChanged === true, attachments: [] })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .filter((u) => { const k = `${u.at.slice(0, 10)}|${u.text}`; if (seen.has(k)) return false; seen.add(k); return true; });
  return ClientTimelineDto.parse({ updates: collapseClientUpdates(updates), history: collapseClientHistory(history) });
}

/** D-19: previous orders of the same product for this org (state ≥ delivered), excluding `excludeOrderId`. */
export async function previousOrdersOfProduct(db: DbOrTx, orgId: string, productId: string | null, excludeOrderId?: string | null) {
  if (!productId) return [];
  const rows = await db.select({ ol: orderLines, o: orders }).from(orderLines).innerJoin(orders, eq(orders.id, orderLines.orderId))
    .where(and(eq(orders.orgId, orgId), eq(orderLines.productId, productId), isNull(orders.deletedAt), inArray(orders.state, ["delivered", "completed"]))).orderBy(desc(orders.deliveredAt));
  return rows.filter((r) => r.o.id !== excludeOrderId).map(({ ol, o }) => ClientPreviousOrderDto.parse({ orderRef: o.ref, qty: ol.qty, unit: ol.unit, unitPrice: { minorE2: ol.unitPriceMinorE2, currency: o.currency, unit: ol.unit }, fee: o.pricingDisplay === "factory_plus_fee" ? { minor: ol.feeMinor, currency: o.currency } : null, deliveredAt: o.deliveredAt?.toISOString() ?? null }));
}

export function lineDto(lc: LineContext, extra: { specSummary: string | null; factoryLabel: string | null; sampleSkipped: boolean; extras: ReturnType<typeof lineExtras> }) {
  const priceE2 = lc.order?.orderLine ? lc.order.orderLine.unitPriceMinorE2 : lc.offer?.status === "accepted" || lc.offer?.status === "sent" ? lc.offer.acceptedUnitPriceMinorE2 : null;
  const feeMinor = lc.order?.orderLine ? lc.order.orderLine.feeMinor : lc.offer?.acceptedFeeMinor ?? null;
  const pricingDisplay = lc.order?.pricingDisplay ?? lc.offer?.pricingDisplay ?? "factory_plus_fee";
  const etaDate = lc.order?.etaPort ?? lc.order?.exworksEta ?? null;
  return ClientRequestLineDto.parse({
    id: lc.id, ref: lc.ref, requestRef: lc.requestRef, lineNo: lc.lineNo, name: lc.name, qty: lc.qty, unit: lc.unit, clientSku: lc.clientSku, links: lc.links, note: lc.note,
    state: lc.state, milestone: lc.milestone, milestoneStep: milestoneStep(lc.milestone),
    subLabel: subLabelFor(lc.state, { agentName: lc.agentName, reached: lc.sourcing.reached, priced: lc.sourcing.priced, isRepeat: lc.isRepeat, offerStatus: lc.offer?.status }),
    exception: lc.exception, exceptionText: exceptionClientText(lc.exception), sourcingProgress: lc.sourcing, agentName: lc.agentName, specVersion: lc.specVersion, specSummary: extra.specSummary,
    isRepeat: lc.isRepeat, fromCatalog: lc.fromCatalog, factoryLabel: extra.factoryLabel, waitingReason: clientWaitingReason(lc),
    price: priceE2 !== null && priceE2 !== undefined ? { minorE2: priceE2, currency: lc.offer?.currency ?? "USD", unit: lc.unit } : null,
    fee: pricingDisplay === "factory_plus_fee" && feeMinor !== null && feeMinor !== undefined ? { minor: feeMinor, currency: lc.offer?.currency ?? "USD" } : null,
    etaDate, etaLabel: etaLabelFor(lc), offerRef: lc.offer && lc.offer.status !== "draft" ? lc.offer.ref : null, sampleRef: lc.sample?.ref ?? null, orderRef: lc.order?.ref ?? null,
    sampleSkipped: extra.sampleSkipped, lastChangeAt: lc.lastStateChangeAt.toISOString(), updatedAt: lc.updatedAt.toISOString(),
    canEdit: ["draft", "submitted", "in_review"].includes(lc.state) && lc.exception !== "cancelled", canCancel: isBeforeOrder(lc.state) && lc.exception !== "cancelled",
    ...extra.extras, canRequestChange: canRequestSpecChange(lc),
  });
}

/** QA-08: a frozen spec (before an order exists) can only change through a formal change request. */
export const canRequestSpecChange = (lc: Pick<LineContext, "state" | "exception" | "specVersion">) =>
  !!lc.specVersion && isBeforeOrder(lc.state) && !["draft", "submitted", "in_review"].includes(lc.state) && lc.exception !== "cancelled" && lc.exception !== "change_requested";

export async function getClientLine(ctx: Ctx, ref: string) {
  if (!isClient(ctx)) throw new Forbidden("clients only");
  const db = await getDb();
  const lc = await clientLineContext(db, ctx, ref);
  const [org] = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, ctx.orgId)).limit(1);
  const [line] = await db.select({ productId: requestLines.productId, specVersion: requestLines.specVersion }).from(requestLines).where(eq(requestLines.id, lc.id)).limit(1);
  const [specRow] = line.productId && line.specVersion
    ? await db.select({ fields: productSpecs.fields }).from(productSpecs).where(and(eq(productSpecs.productId, line.productId), eq(productSpecs.version, line.specVersion))).limit(1)
    : [];
  const specSummary = specRow ? Object.entries(specRow.fields).map(([k, v]) => (typeof v === "boolean" ? (v ? k : `not ${k}`) : `${k} ${v}`)).join(", ") || null : null;
  const sampleRows = await db.select().from(samples).where(and(eq(samples.requestLineId, lc.id), eq(samples.orgId, ctx.orgId), isNull(samples.deletedAt))).orderBy(desc(samples.createdAt));
  const latestSample = sampleRows[0] ?? null;
  const sampleSkipped = MILESTONES.indexOf(lc.milestone) > MILESTONES.indexOf("sample") && !sampleRows.some((s) => s.status === "approved");
  const factoryLabel = await factoryLabelForLine(db, { lineId: lc.id, orgId: ctx.orgId });
  const [timeline, documents_, previousOrders] = await Promise.all([
    clientTimeline(db, ctx, lc),
    clientDocuments(db, ctx.orgId, [{ entityType: "request_line", entityId: lc.id }, ...sampleRows.map((s) => ({ entityType: "sample" as const, entityId: s.id })), ...(lc.order ? [{ entityType: "order" as const, entityId: lc.order.id }] : [])]),
    previousOrdersOfProduct(db, ctx.orgId, line.productId, lc.order?.id),
  ]);
  // offer card: latest non-draft offer
  let offerCard = null;
  const offerRow = lc.offer && lc.offer.status !== "draft" ? (await db.select().from(offers).where(eq(offers.id, lc.offer.id)).limit(1))[0] : null;
  if (offerRow) {
    const opts = await db.select().from(offerOptions).where(eq(offerOptions.offerId, offerRow.id));
    const opt = (offerRow.acceptedOptionId ? opts.find((o) => o.id === offerRow.acceptedOptionId) : null) ?? opts.find((o) => o.label === "A") ?? opts[0] ?? null;
    const e2 = opt ? unitPriceAtQty(opt.priceBreaks, lc.qty) : null;
    offerCard = ClientLineOfferCardDto.parse({
      ref: offerRow.ref, href: `/app/offers/${offerRow.ref}`, version: offerRow.version, status: offerRow.status, validUntil: offerRow.validUntil,
      acceptedOptionLabel: opt && offerRow.acceptedOptionId === opt.id ? opt.label : null,
      unitPrice: e2 !== null && opt ? { minorE2: e2, currency: offerRow.currency, unit: opt.unit } : null,
      fee: opt && offerRow.pricingDisplay === "factory_plus_fee" ? { minor: opt.feeMinor, currency: offerRow.currency } : null,
      moq: opt?.moq ?? null, leadDays: opt?.leadDays ?? null, decidedAt: offerRow.decidedAt?.toISOString() ?? null,
    });
  }
  const [dates, specs] = await Promise.all([milestoneDatesFor(db, ctx.orgId, [lc]), specFieldsFor(db, [lc.id])]);
  // QA-23 (SPEC 5.5): the "Factory F-nnnn" label only on lines created from a range; the "More from this factory" link only once ordered
  const dto = lineDto(lc, { specSummary, factoryLabel: lc.fromRangeId ? factoryLabel : null, sampleSkipped, extras: lineExtras(lc, dates, specs) });
  const primaryAction = dto.waitingReason === "offer_sent" && offerCard ? { label: "Accept price", href: offerCard.href }
    : dto.waitingReason === "sample_received" && latestSample ? { label: "Approve sample", href: `/app/samples/${latestSample.ref}` }
    : dto.waitingReason === "deposit_due" && lc.order ? { label: "View invoice", href: `/app/orders/${lc.order.ref}#payments` }
    : dto.waitingReason === "artwork_due" && lc.order ? { label: "Upload artwork", href: `/app/orders/${lc.order.ref}#artwork` }
    : dto.waitingReason === "balance_due" && lc.order ? { label: "View QC report", href: `/app/orders/${lc.order.ref}#qc` }
    : dto.waitingReason === "delivery_confirm" && lc.order ? { label: "Confirm delivery", href: `/app/orders/${lc.order.ref}` }
    : dto.waitingReason === "needs_input" ? { label: "Answer", href: `#ask` } : null;
  return ClientLinePageDto.parse({
    companyLabel: org?.name ?? "",
    line: dto,
    waitingReasonDetail: dto.waitingReason === "offer_sent" && offerCard?.validUntil ? `valid until ${offerCard.validUntil}` : null,
    openQuestion: lc.exception === "needs_input" ? lc.openQuestion : null,
    timeline, documents: documents_, previousOrders,
    offer: offerCard,
    sample: latestSample ? ClientLineSampleCardDto.parse({ ref: latestSample.ref, href: `/app/samples/${latestSample.ref}`, status: latestSample.status, courier: latestSample.courier, tracking: latestSample.tracking, receivedAt: latestSample.receivedAt?.toISOString() ?? null, decidedAt: latestSample.decidedAt?.toISOString() ?? null }) : null,
    order: lc.order ? ClientLineOrderCardDto.parse({ ref: lc.order.ref, href: `/app/orders/${lc.order.ref}`, state: lc.order.state, milestone: lc.order.milestone, etaLabel: etaLabelFor(lc) }) : null,
    factoryRange: factoryLabel && lc.order ? { label: factoryLabel, href: `/app/orders/${lc.order.ref}/range` } : null,
    primaryAction,
  });
}
