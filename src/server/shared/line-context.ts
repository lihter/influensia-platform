/**
 * Loads everything the derived functions (waitingOn / isStale / milestone sub-labels) need for a set of request lines,
 * in plain app-schema terms. Used by both dashboards. Nothing supplier-shaped is returned: the only supplier-derived
 * values are the sourcing counts and the ex-works ETA date.
 */
import { and, desc, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import type { DbOrTx } from "@/db";
import { requestLines, requests, organizations, offers, offerOptions, samples, orders, orderLines, payments, artworks, shipments, comments } from "@/db/schema/app";
import { purchaseOrders } from "@/db/schema/supplier";
import type { LineState, LineException, Milestone, OfferStatus, SampleStatus, PaymentKind, PaymentStatus, ArtworkStatus, PricingDisplay } from "@/db/enums";
import { waitingOn, isStale, type WaitingOn } from "./derived";
import { sourcingCounts } from "./sourcing-counts";
import { userNames } from "./users";
import { now } from "./clock";
import type { PriceBreak } from "@/db/types";

export type LineContext = {
  id: string;
  ref: string;
  requestId: string;
  requestRef: string;
  requestStatus: string;
  orgId: string;
  orgName: string;
  lineNo: number;
  name: string;
  qty: number | null;
  unit: string;
  clientSku: string | null;
  links: string[];
  note: string | null;
  state: LineState;
  milestone: Milestone;
  exception: LineException | null;
  exceptionReason: string | null;
  assignedAgentId: string | null;
  agentName: string | null;
  specVersion: number | null;
  isRepeat: boolean;
  fromCatalog: boolean;
  fromRangeId: string | null;
  sampleRequired: boolean;
  lastStateChangeAt: Date;
  updatedAt: Date;
  createdAt: Date;
  sourcing: { reached: number; priced: number };
  offer: { id: string; ref: string; status: OfferStatus; validUntil: string | null; pricingDisplay: PricingDisplay; acceptedUnitPriceMinorE2: number | null; acceptedFeeMinor: number | null; currency: string; sampleRequired: boolean | null } | null;
  sample: { id: string; ref: string; status: SampleStatus } | null;
  order: {
    id: string; ref: string; state: LineState; milestone: Milestone; exception: LineException | null; exceptionReason: string | null;
    lastStateChangeAt: Date; pricingDisplay: PricingDisplay; assignedAgentId: string | null; deliveredAt: Date | null; completedAt: Date | null;
    payments: { id: string; kind: PaymentKind; status: PaymentStatus; amountMinor: number; currency: string; dueOn: string | null; paidAt: Date | null }[];
    artworks: ({ status: ArtworkStatus } | null)[];
    exworksEta: string | null;
    etaPort: string | null;
    portOfDischarge: string | null;
    orderLine: { unitPriceMinorE2: number; feeMinor: number; qty: number; unit: string; artworkRequired: boolean } | null;
  } | null;
  /** latest open client-visible question from an agent (needs_input excerpt) */
  openQuestion: string | null;
  /** when that question was asked (QA-29: "since" for needs_input) */
  openQuestionAt: Date | null;
  waiting: WaitingOn;
  stale: boolean;
};

const unitPriceAtQty = (breaks: PriceBreak[] | null | undefined, qty: number | null) => {
  if (!breaks?.length) return null;
  const sorted = [...breaks].sort((a, b) => a.min_qty - b.min_qty);
  const brk = qty ? [...sorted].reverse().find((b) => b.min_qty <= qty) ?? sorted[0] : sorted[0];
  return brk.unit_price_minor_e2;
};

export async function loadLineContexts(db: DbOrTx, filter: { orgId?: string; lineIds?: string[]; includeCancelled?: boolean; includeDrafts?: boolean }, at: Date = now()): Promise<LineContext[]> {
  const conds: SQL[] = [isNull(requestLines.deletedAt)];
  if (filter.orgId) conds.push(eq(requestLines.orgId, filter.orgId));
  if (filter.lineIds) { if (!filter.lineIds.length) return []; conds.push(inArray(requestLines.id, filter.lineIds)); }
  if (!filter.includeCancelled) conds.push(or(isNull(requestLines.exception), sql`${requestLines.exception} <> 'cancelled'`)!);
  if (!filter.includeDrafts) conds.push(sql`${requestLines.state} <> 'draft'`);

  const rows = await db
    .select({ line: requestLines, requestRef: requests.ref, requestStatus: requests.status, orgName: organizations.name })
    .from(requestLines)
    .innerJoin(requests, eq(requests.id, requestLines.requestId))
    .innerJoin(organizations, eq(organizations.id, requestLines.orgId))
    .where(and(...conds))
    .orderBy(requests.ref, requestLines.lineNo);
  if (!rows.length) return [];
  const ids = rows.map((r) => r.line.id);

  const [counts, names, offerRows, sampleRows, olRows, questionRows] = await Promise.all([
    sourcingCounts(db, ids),
    userNames(db, rows.map((r) => r.line.assignedAgentId).filter((x): x is string => !!x)),
    db.select().from(offers).where(and(inArray(offers.requestLineId, ids), isNull(offers.deletedAt))).orderBy(desc(offers.version)),
    db.select().from(samples).where(and(inArray(samples.requestLineId, ids), isNull(samples.deletedAt))).orderBy(desc(samples.createdAt)),
    db.select({ ol: orderLines, order: orders }).from(orderLines).innerJoin(orders, eq(orders.id, orderLines.orderId)).where(and(inArray(orderLines.requestLineId, ids), isNull(orders.deletedAt))),
    db.select({ entityId: comments.entityId, body: comments.body, createdAt: comments.createdAt }).from(comments)
      .where(and(eq(comments.entityType, "request_line"), inArray(comments.entityId, ids), eq(comments.visibility, "client"), eq(comments.kind, "question"), isNull(comments.deletedAt)))
      .orderBy(desc(comments.createdAt)),
  ]);

  const latestOffer = new Map<string, typeof offerRows[number]>();
  for (const o of offerRows) if (!latestOffer.has(o.requestLineId)) latestOffer.set(o.requestLineId, o);
  const acceptedOptionIds = [...latestOffer.values()].map((o) => o.acceptedOptionId).filter((x): x is string => !!x);
  const optionRows = acceptedOptionIds.length ? await db.select().from(offerOptions).where(inArray(offerOptions.id, acceptedOptionIds)) : [];
  const optionById = new Map(optionRows.map((o) => [o.id, o]));

  const latestSample = new Map<string, typeof sampleRows[number]>();
  for (const s of sampleRows) if (s.requestLineId && !latestSample.has(s.requestLineId)) latestSample.set(s.requestLineId, s);

  const orderIds = [...new Set(olRows.map((r) => r.order.id))];
  const [payRows, artRows, shipRows, poRows, orderAgentNames] = orderIds.length
    ? await Promise.all([
        db.select().from(payments).where(and(inArray(payments.orderId, orderIds), isNull(payments.deletedAt))),
        db.select().from(artworks).where(and(inArray(artworks.orderLineId, olRows.map((r) => r.ol.id)), isNull(artworks.deletedAt))).orderBy(desc(artworks.version)),
        db.select().from(shipments).where(and(inArray(shipments.orderId, orderIds), isNull(shipments.deletedAt))),
        db.select({ orderId: purchaseOrders.orderId, eta: purchaseOrders.exworksEta }).from(purchaseOrders).where(and(inArray(purchaseOrders.orderId, orderIds), isNull(purchaseOrders.deletedAt))),
        userNames(db, olRows.map((r) => r.order.assignedAgentId).filter((x): x is string => !!x)),
      ])
    : [[], [], [], [], {}];
  Object.assign(names, orderAgentNames);
  const olByLine = new Map(olRows.map((r) => [r.ol.requestLineId, r]));
  const olIdsByOrder = new Map<string, string[]>();
  for (const r of olRows) olIdsByOrder.set(r.order.id, [...(olIdsByOrder.get(r.order.id) ?? []), r.ol.id]);
  const latestArtByOl = new Map<string, typeof artRows[number]>();
  for (const a of artRows) if (!latestArtByOl.has(a.orderLineId)) latestArtByOl.set(a.orderLineId, a);
  const openQuestion = new Map<string, string>();
  const openQuestionAt = new Map<string, Date>();
  for (const q of questionRows) if (!openQuestion.has(q.entityId)) { openQuestion.set(q.entityId, q.body); openQuestionAt.set(q.entityId, q.createdAt); }

  return rows.map(({ line, requestRef, requestStatus, orgName }) => {
    const o = latestOffer.get(line.id) ?? null;
    const opt = o?.acceptedOptionId ? optionById.get(o.acceptedOptionId) : null;
    const s = latestSample.get(line.id) ?? null;
    const olr = olByLine.get(line.id) ?? null;
    let order: LineContext["order"] = null;
    if (olr) {
      const ord = olr.order;
      const ols = olIdsByOrder.get(ord.id) ?? [];
      const ship = shipRows.find((x) => x.orderId === ord.id) ?? null;
      const etas = poRows.filter((p) => p.orderId === ord.id).map((p) => p.eta).filter((x): x is string => !!x).sort();
      order = {
        id: ord.id, ref: ord.ref, state: ord.state, milestone: ord.milestone, exception: ord.exception, exceptionReason: ord.exceptionReason,
        lastStateChangeAt: ord.lastStateChangeAt, pricingDisplay: ord.pricingDisplay, assignedAgentId: ord.assignedAgentId, deliveredAt: ord.deliveredAt, completedAt: ord.completedAt,
        payments: payRows.filter((p) => p.orderId === ord.id).map((p) => ({ id: p.id, kind: p.kind, status: p.status, amountMinor: p.amountMinor, currency: p.currency, dueOn: p.dueOn, paidAt: p.paidAt })),
        artworks: ols.map((olId) => { const a = latestArtByOl.get(olId); const req = olRows.find((r) => r.ol.id === olId)?.ol.artworkRequired; return req === false ? { status: "approved" as const } : a ? { status: a.status } : null; }),
        exworksEta: etas[0] ?? null,
        etaPort: ship?.etaPort ?? null,
        portOfDischarge: ship?.portOfDischarge ?? null,
        orderLine: { unitPriceMinorE2: olr.ol.unitPriceMinorE2, feeMinor: olr.ol.feeMinor, qty: olr.ol.qty, unit: olr.ol.unit, artworkRequired: olr.ol.artworkRequired },
      };
    }
    const state = order ? order.state : line.state;
    const exception = order ? order.exception ?? line.exception : line.exception;
    const waitingInput = { state, exception, offerStatus: o?.status ?? null, sampleStatus: s?.status ?? null, payments: order?.payments ?? [], artworks: order?.artworks ?? [] };
    const lastChange = order ? order.lastStateChangeAt : line.lastStateChangeAt;
    return {
      id: line.id, ref: line.lineRef, requestId: line.requestId, requestRef, requestStatus, orgId: line.orgId, orgName,
      lineNo: line.lineNo, name: line.name, qty: line.qtyFirst, unit: line.unit, clientSku: line.clientSku, links: line.clientLinks, note: line.customisation,
      state, milestone: order ? order.milestone : line.milestone, exception, exceptionReason: order?.exceptionReason ?? line.exceptionReason,
      assignedAgentId: line.assignedAgentId ?? order?.assignedAgentId ?? null,
      agentName: (line.assignedAgentId && names[line.assignedAgentId]) || (order?.assignedAgentId && names[order.assignedAgentId]) || null,
      specVersion: line.specVersion, isRepeat: line.isRepeat, fromCatalog: line.fromCatalog, fromRangeId: line.fromRangeId, sampleRequired: line.sampleRequired,
      lastStateChangeAt: lastChange, updatedAt: line.updatedAt, createdAt: line.createdAt,
      sourcing: counts[line.id] ?? { reached: 0, priced: 0 },
      offer: o ? { id: o.id, ref: o.ref, status: o.status, validUntil: o.validUntil, pricingDisplay: o.pricingDisplay, acceptedUnitPriceMinorE2: opt ? unitPriceAtQty(opt.priceBreaks, line.qtyFirst) : null, acceptedFeeMinor: opt?.feeMinor ?? null, currency: o.currency, sampleRequired: opt?.sampleRequired ?? null } : null,
      sample: s ? { id: s.id, ref: s.ref, status: s.status } : null,
      order,
      openQuestion: openQuestion.get(line.id) ?? null,
      openQuestionAt: openQuestionAt.get(line.id) ?? null,
      waiting: waitingOn(waitingInput),
      stale: isStale({ ...waitingInput, lastStateChangeAt: lastChange }, at),
    };
  });
}
