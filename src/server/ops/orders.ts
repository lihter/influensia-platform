/**
 * Orders (SPEC F-22): ops list + one long order page, and every execution-lane mutation — confirm order from accepted
 * offers, payments, artwork decisions, purchase orders + ETA, inspections, shipment, delivery, timeline posts.
 * Every mutation runs in one transaction, logs activity and enqueues the SPEC §6 template; state moves only through
 * transitionOrder(). Ops only — the client projection lives in src/server/client/orders.ts.
 */
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { getDb, type DbOrTx } from "@/db";
import {
  orders, orderLines, requestLines, requests, organizations, payments, artworks, inspections, shipments, documents, files, comments, activityEvents, offers, offerOptions, samples, factoryRanges,
} from "@/db/schema/app";
import { purchaseOrders, suppliers, supplierParticipations, supplierContacts, quotes } from "@/db/schema/supplier";
import { recordSupplierPerformance } from "@/server/shared/supplier-performance";
import type { LineState, Milestone, LineException, CommercialMode, PricingDisplay, PaymentKind, PaymentStatus, Payee, ArtworkStatus, PoStatus, InspectionResult, ShipmentMode, ForwarderParty, CustomsStatus, DocumentKind, Visibility } from "@/db/enums";
import type { PriceBreak } from "@/db/types";
import { type Ctx, isOps, isAdmin, Forbidden, NotFound } from "@/server/shared/authorize";
import { logActivity } from "@/server/shared/activity";
import { enqueue } from "@/server/shared/outbox";
import { transition, transitionOrder, setException } from "@/server/shared/transition";
import { TRANSITIONS, milestoneStep, type State } from "@/server/shared/state-machine";
import { loadLineContexts } from "@/server/shared/line-context";
import { waitingOn, isStale, type WaitingOn } from "@/server/shared/derived";
import { clientUsersOf, userNames } from "@/server/shared/users";
import { formatMoney, lineTotalMinor } from "@/server/shared/money";
import { formatDate, addWorkingDays, isoDate as toIsoDate } from "@/server/shared/dates";
import { now, today } from "@/server/shared/clock";
import { orderRefFromRequest, poRef as mkPoRef, piNumber as mkPiNumber } from "@/server/shared/ids";
import { getStorage } from "@/server/shared/storage";
import { assertClean, loadLeakSources } from "@/server/shared/leak-check";
import { eventText } from "@/server/shared/labels";
import { collapseOpsFeed } from "@/server/shared/timeline";
import { label } from "@/lib/labels";
import { listDocumentsFor, uploadDocument, publishDocument, throwIfBlocked, type OpsDocumentRow, type PublishResult } from "./documents";

/** Domain preconditions (SPEC §3.4 "Pre" column) surfaced to the UI as `{ ok: false, error: code }`. */
export class OrderError extends Error {
  status = 409;
  constructor(public code: "E_BALANCE_NOT_PAID" | "E_ARTWORK_NOT_APPROVED" | "E_PAYMENTS_PENDING" | "E_ARTWORK_REQUIRED" | "E_NOTE_REQUIRED" | "E_NO_ELIGIBLE_LINES" | "E_NOT_DELIVERED" | "E_NOT_REORDERABLE" | "E_NO_LINES") { super(code); }
}

/* ═══════════════════════════ pure helpers (unit-tested) ═══════════════════════════ */

/** QA-04: what the client reads when an order is confirmed — no invoice claim until the PI is published. */
export const ORDER_CONFIRMED_TEXT = "Order confirmed — we're preparing your invoice";

/** Unit price from an option's ladder at a quantity (largest break ≤ qty, else the smallest). */
export function unitPriceAtQty(breaks: PriceBreak[] | null | undefined, qty: number | null): number | null {
  if (!breaks?.length) return null;
  const sorted = [...breaks].sort((a, b) => a.min_qty - b.min_qty);
  const brk = qty ? [...sorted].reverse().find((b) => b.min_qty <= qty) ?? sorted[0] : sorted[0];
  return brk.unit_price_minor_e2;
}

export type PaymentPlan = { kind: PaymentKind; pct: number | null; amountMinor: number; payee: Payee }[];

/**
 * SPEC F-22 confirm order: deposit = pct of goods, fee flat, balance = goods − deposit. Payee `agency` for
 * agency_passthrough / principal; `factory` for agency_direct except the fee.
 */
export function paymentPlan(p: { goodsMinor: number; feeMinor: number; depositPct: number; commercialMode: CommercialMode }): PaymentPlan {
  const deposit = Math.round((p.goodsMinor * p.depositPct) / 100);
  const goodsPayee: Payee = p.commercialMode === "agency_direct" ? "factory" : "agency";
  const plan: PaymentPlan = [{ kind: "deposit", pct: p.depositPct, amountMinor: deposit, payee: goodsPayee }];
  if (p.feeMinor > 0) plan.push({ kind: "fee", pct: null, amountMinor: p.feeMinor, payee: "agency" });
  plan.push({ kind: "balance", pct: 100 - p.depositPct, amountMinor: p.goodsMinor - deposit, payee: goodsPayee });
  return plan;
}

export type PrimaryAction = { key: string; label: string; anchor: string };

/** DESIGN §6.10 "stage primary" — one button per state (the section it lives in). */
export function primaryActionFor(p: { state: LineState; exception: LineException | null; depositAndFeePaid: boolean; artworkNeeded: boolean; artworkApproved: boolean; balancePaid: boolean }): PrimaryAction | null {
  switch (p.state) {
    case "order_confirmed": return { key: "publish_pi", label: "Publish PI", anchor: "#documents" };
    case "awaiting_deposit": return p.depositAndFeePaid && !p.artworkNeeded ? { key: "start_production", label: "Start production", anchor: "#purchase-orders" } : { key: "record_payment", label: "Record payment", anchor: "#payments" };
    case "awaiting_artwork": return p.artworkApproved ? { key: "start_production", label: "Start production", anchor: "#purchase-orders" } : { key: "approve_artwork", label: "Approve artwork", anchor: "#artwork" };
    case "in_production": return { key: "schedule_inspection", label: p.exception === "qc_failed" ? "Schedule re-inspection" : "Schedule inspection", anchor: "#inspection" };
    case "qc_inspection": return { key: "record_inspection", label: "Record result", anchor: "#inspection" };
    case "awaiting_balance": return p.balancePaid ? { key: "record_forwarder", label: "Record forwarder", anchor: "#shipment" } : { key: "record_payment", label: "Record balance", anchor: "#payments" };
    case "forwarder_booked": return { key: "mark_shipped", label: "Mark shipped ex-works", anchor: "#shipment" };
    case "shipped_exworks": return { key: "mark_departed", label: "Mark departed", anchor: "#shipment" };
    case "departed_origin": return { key: "mark_arrived", label: "Arrived at port", anchor: "#shipment" };
    case "eu_port_customs": return { key: "mark_delivered", label: "Mark delivered", anchor: "#shipment" };
    case "delivered": return { key: "close", label: "Close order", anchor: "#header" };
    default: return null;
  }
}

/** Order-level transitions an agent may trigger from the "Change state" sheet (SPEC §3.4, execution lane only). */
export function allowedOrderTransitions(state: LineState): State[] {
  return [...(TRANSITIONS[state] ?? [])];
}

/** QA-49: payments always read Deposit, Fee, Balance, Sample — never re-ordered by updates. */
const KIND_RANK: Record<string, number> = { deposit: 0, fee: 1, balance: 2, sample: 3 };
export const byPaymentKind = (a: { kind: string; createdAt: Date }, b: { kind: string; createdAt: Date }) => (KIND_RANK[a.kind] ?? 9) - (KIND_RANK[b.kind] ?? 9) || a.createdAt.getTime() - b.createdAt.getTime();

export const isOverdue = (dueOn: string | null, status: PaymentStatus, ref = today()) => status === "pending" && !!dueOn && dueOn < ref;

/** Enum arrays for the zod schemas in actions.ts (which may not import @/db directly). */
export { LINE_STATES, PAYMENT_KINDS, PAYEES, LINE_EXCEPTIONS, SHIPMENT_MODES, FORWARDER_PARTIES, CUSTOMS_STATUSES, INSPECTION_RESULTS, PO_STATUSES, DOCUMENT_KINDS, COMMERCIAL_MODES, PRICING_DISPLAYS, INCOTERMS } from "@/db/enums";

/* ═══════════════════════════ types ═══════════════════════════ */

export type DocRef = { id: string; filename: string; kind: DocumentKind; visibility: Visibility; bytes: number; downloadUrl: string; uploadedAt: string };

export type OpsOrderRow = {
  id: string; ref: string; href: string; name: string; orgName: string; orgId: string; linesCount: number;
  state: LineState; milestone: Milestone; exception: LineException | null;
  dueMinor: number; paidMinor: number; currency: string;
  eta: string | null; etaKind: "exworks" | "port" | "delivered" | null;
  agentName: string | null; agentId: string | null; stale: boolean; lastChangeAt: string; waitingParty: WaitingOn["party"];
};

export type OpsOrderLine = {
  id: string; requestLineId: string; lineRef: string; lineNo: number; name: string; qty: number; unit: string; unitPriceMinorE2: number; feeMinor: number; factoryUnitPriceMinorE2: number | null;
  currency: string; specVersion: number | null; artworkRequired: boolean; supplierName: string | null; supplierRef: string | null; poRef: string | null; poId: string | null; clientSku: string | null;
};
export type OpsPayment = { id: string; kind: PaymentKind; pct: number | null; amountMinor: number; currency: string; payee: Payee; status: PaymentStatus; dueOn: string | null; paidAt: string | null; reference: string | null; recordedByName: string | null; overdue: boolean };
export type OpsArtwork = {
  orderLineId: string; lineRef: string; lineName: string; artworkRequired: boolean;
  current: { id: string; version: number; status: ArtworkStatus; clientNote: string | null; internalNote: string | null; decidedAt: string | null; decidedByName: string | null; file: DocRef | null } | null;
  versions: { id: string; version: number; status: ArtworkStatus; createdAt: string; file: DocRef | null }[];
  dieline: DocRef | null;
};
export type OpsPurchaseOrder = { id: string; ref: string; supplierId: string; supplierName: string; supplierRef: string; contactName: string | null; factoryTotalMinor: number; currency: string; terms: string | null; exworksEta: string | null; status: PoStatus; issuedAt: string | null; document: DocRef | null; factoryLabel: string | null; disclosed: boolean; lineRefs: string[] };
export type OpsInspection = { id: string; poRef: string | null; inspector: string | null; scheduledFor: string | null; inspectedAt: string | null; aql: string | null; sampleSize: number | null; result: InspectionResult | null; defectsNote: string | null; visibleToClient: boolean; report: DocRef | null; createdAt: string };
export type OpsShipment = { id: string; forwarder: string | null; forwarderParty: ForwarderParty | null; forwarderContact: string | null; bookingRef: string | null; mode: ShipmentMode | null; containerOrAwb: string | null; cargoReady: string | null; exworksShippedAt: string | null; etd: string | null; etaPort: string | null; portOfDischarge: string | null; arrivedPortAt: string | null; customsStatus: CustomsStatus; deliveredAt: string | null; bl: DocRef | null; packingList: DocRef | null };
export type OpsTimelineEntry = {
  id: string; kind: "milestone" | "action_milestone" | "note" | "whatsapp" | "question" | "system" | "document"; at: string; title: string | null; body: string | null; author: string | null; visibility: Visibility; counterparty: string | null; type: string;
  attachments: { id: string; name: string; href: string }[];
};

export type OpsOrderDetail = {
  order: {
    id: string; ref: string; orgId: string; orgName: string; requestId: string; requestRef: string; commercialMode: CommercialMode; pricingDisplay: PricingDisplay; incoterm: string | null; port: string | null; piNumber: string | null;
    state: LineState; milestone: Milestone; milestoneStep: number; exception: LineException | null; exceptionReason: string | null; confirmedAt: string | null; deliveredAt: string | null; completedAt: string | null;
    totalMinor: number; currency: string; depositPct: number; agentName: string | null; agentId: string | null; lastChangeAt: string; stale: boolean; waiting: WaitingOn;
    allowedTransitions: State[]; primaryAction: PrimaryAction | null; exworksEta: string | null; etaPort: string | null; portOfDischarge: string | null; sampleSkipped: boolean; name: string;
    depositAndFeePaid: boolean; balancePaid: boolean; nextPayment: { kind: PaymentKind; amountMinor: number; currency: string; dueOn: string | null } | null; isAdmin: boolean;
  };
  lines: OpsOrderLine[];
  payments: OpsPayment[];
  artworks: OpsArtwork[];
  purchaseOrders: OpsPurchaseOrder[];
  inspections: OpsInspection[];
  shipment: OpsShipment | null;
  documents: OpsDocumentRow[];
  timeline: OpsTimelineEntry[];
};

/* ═══════════════════════════ reads ═══════════════════════════ */

export async function listOrders(ctx: Ctx): Promise<OpsOrderRow[]> {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const db = await getDb();
  const lcs = await loadLineContexts(db, { includeCancelled: true });
  const rows = new Map<string, OpsOrderRow>();
  for (const lc of lcs) {
    if (!lc.order) continue;
    const o = lc.order;
    const existing = rows.get(o.id);
    if (existing) { existing.linesCount++; continue; }
    const pays = o.payments;
    rows.set(o.id, {
      id: o.id, ref: o.ref, href: `/ops/orders/${o.ref}`, name: lc.name, orgName: lc.orgName, orgId: lc.orgId, linesCount: 1,
      state: o.state, milestone: o.milestone, exception: o.exception,
      dueMinor: pays.filter((p) => p.status === "pending").reduce((s, p) => s + p.amountMinor, 0),
      paidMinor: pays.filter((p) => p.status === "paid").reduce((s, p) => s + p.amountMinor, 0),
      currency: pays[0]?.currency ?? "USD",
      eta: o.deliveredAt ? toIsoDate(o.deliveredAt) : o.etaPort ?? o.exworksEta, etaKind: o.deliveredAt ? "delivered" : o.etaPort ? "port" : o.exworksEta ? "exworks" : null,
      agentName: lc.agentName, agentId: lc.assignedAgentId, stale: lc.stale, lastChangeAt: o.lastStateChangeAt.toISOString(), waitingParty: lc.waiting.party,
    });
  }
  return [...rows.values()].sort((a, b) => b.lastChangeAt.localeCompare(a.lastChangeAt));
}

async function docRefs(db: DbOrTx, ids: (string | null | undefined)[]): Promise<Record<string, DocRef>> {
  const clean = [...new Set(ids.filter((x): x is string => !!x))];
  if (!clean.length) return {};
  const rows = await db.select({ d: documents, f: files }).from(documents).innerJoin(files, eq(files.id, documents.fileId)).where(and(inArray(documents.id, clean), isNull(documents.deletedAt)));
  const storage = getStorage();
  const out: Record<string, DocRef> = {};
  for (const { d, f } of rows) out[d.id] = { id: d.id, filename: d.filename, kind: d.kind, visibility: d.visibility, bytes: f.bytes, downloadUrl: await storage.downloadUrl(f.storageKey, { filename: d.filename }), uploadedAt: d.createdAt.toISOString() };
  return out;
}

async function docByFileId(db: DbOrTx, fileIds: (string | null | undefined)[]): Promise<Record<string, DocRef>> {
  const clean = [...new Set(fileIds.filter((x): x is string => !!x))];
  if (!clean.length) return {};
  const rows = await db.select({ d: documents, f: files }).from(documents).innerJoin(files, eq(files.id, documents.fileId)).where(and(inArray(documents.fileId, clean), isNull(documents.deletedAt)));
  const storage = getStorage();
  const out: Record<string, DocRef> = {};
  for (const { d, f } of rows) out[f.id] = { id: d.id, filename: d.filename, kind: d.kind, visibility: d.visibility, bytes: f.bytes, downloadUrl: await storage.downloadUrl(f.storageKey, { filename: d.filename }), uploadedAt: d.createdAt.toISOString() };
  return out;
}

export async function getOpsOrderRefById(id: string): Promise<string | null> {
  const db = await getDb();
  const [o] = await db.select({ ref: orders.ref }).from(orders).where(eq(orders.id, id)).limit(1);
  return o?.ref ?? null;
}

export async function orderIdByRef(db: DbOrTx, ref: string): Promise<string | null> {
  const [o] = await db.select({ id: orders.id }).from(orders).where(and(eq(orders.ref, ref), isNull(orders.deletedAt))).limit(1);
  return o?.id ?? null;
}

export async function getOpsOrder(ctx: Ctx, ref: string): Promise<OpsOrderDetail> {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const db = await getDb();
  const [row] = await db.select({ o: orders, orgName: organizations.name, requestRef: requests.ref }).from(orders).innerJoin(organizations, eq(organizations.id, orders.orgId)).innerJoin(requests, eq(requests.id, orders.requestId)).where(and(eq(orders.ref, ref), isNull(orders.deletedAt))).limit(1);
  if (!row) throw new NotFound("order");
  const o = row.o;

  const olRows = await db.select({ ol: orderLines, line: requestLines }).from(orderLines).innerJoin(requestLines, eq(requestLines.id, orderLines.requestLineId)).where(eq(orderLines.orderId, o.id)).orderBy(asc(orderLines.lineNo));
  const lineIds = olRows.map((r) => r.line.id);
  const [payRows, artRows, poRows, inspRows, shipRows, sampleRows] = await Promise.all([
    db.select().from(payments).where(and(eq(payments.orderId, o.id), isNull(payments.deletedAt))).orderBy(asc(payments.createdAt)),
    olRows.length ? db.select().from(artworks).where(and(inArray(artworks.orderLineId, olRows.map((r) => r.ol.id)), isNull(artworks.deletedAt))).orderBy(desc(artworks.version)) : Promise.resolve([]),
    db.select({ po: purchaseOrders, s: suppliers }).from(purchaseOrders).innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId)).where(and(eq(purchaseOrders.orderId, o.id), isNull(purchaseOrders.deletedAt))).orderBy(asc(purchaseOrders.ref)),
    db.select().from(inspections).where(and(eq(inspections.orderId, o.id), isNull(inspections.deletedAt))).orderBy(asc(inspections.createdAt)),
    db.select().from(shipments).where(and(eq(shipments.orderId, o.id), isNull(shipments.deletedAt))).orderBy(desc(shipments.createdAt)).limit(1),
    lineIds.length ? db.select({ id: samples.id, ref: samples.ref }).from(samples).where(and(inArray(samples.requestLineId, lineIds), isNull(samples.deletedAt))) : Promise.resolve([]),
  ]);
  const ship = shipRows[0] ?? null;
  const supplierIds = poRows.map((r) => r.s.id);
  const [contacts, ranges, names] = await Promise.all([
    supplierIds.length ? db.select().from(supplierContacts).where(and(inArray(supplierContacts.supplierId, supplierIds), isNull(supplierContacts.deletedAt))) : Promise.resolve([]),
    supplierIds.length ? db.select({ supplierId: factoryRanges.supplierId, label: factoryRanges.label }).from(factoryRanges).where(and(eq(factoryRanges.orgId, o.orgId), inArray(factoryRanges.supplierId, supplierIds as never), isNull(factoryRanges.deletedAt))) : Promise.resolve([]),
    userNames(db, [o.assignedAgentId, ...payRows.map((p) => p.recordedBy), ...artRows.map((a) => a.decidedBy)].filter((x): x is string => !!x)),
  ]);
  const docs = await docRefs(db, [...poRows.map((r) => r.po.documentId), ...inspRows.map((i) => i.reportDocumentId), ship?.blDocumentId, ship?.packingListDocumentId]);
  const fileDocs = await docByFileId(db, [...artRows.map((a) => a.fileId), ...artRows.map((a) => a.dielineFileId)]);
  const poById = new Map(poRows.map((r) => [r.po.id, r]));

  const lines: OpsOrderLine[] = olRows.map(({ ol, line }) => {
    const po = ol.poId ? poById.get(ol.poId as unknown as string) : undefined;
    return { id: ol.id, requestLineId: line.id, lineRef: line.lineRef, lineNo: ol.lineNo, name: line.name, qty: ol.qty, unit: ol.unit, unitPriceMinorE2: ol.unitPriceMinorE2, feeMinor: ol.feeMinor, factoryUnitPriceMinorE2: ol.factoryUnitPriceMinorE2, currency: o.currency, specVersion: ol.specVersion, artworkRequired: ol.artworkRequired, supplierName: po?.s.legalName ?? null, supplierRef: po?.s.ref ?? null, poRef: po?.po.ref ?? null, poId: po?.po.id ?? null, clientSku: line.clientSku };
  });
  const pays: OpsPayment[] = [...payRows].sort(byPaymentKind).map((p) => ({ id: p.id, kind: p.kind, pct: p.pct, amountMinor: p.amountMinor, currency: p.currency, payee: p.payee, status: p.status, dueOn: p.dueOn, paidAt: p.paidAt?.toISOString() ?? null, reference: p.reference, recordedByName: p.recordedBy ? names[p.recordedBy] ?? null : null, overdue: isOverdue(p.dueOn, p.status) }));
  const documentsList = await listDocumentsFor(db, [
    { entityType: "order", entityId: o.id, label: o.ref },
    ...olRows.map((r) => ({ entityType: "request_line" as const, entityId: r.line.id, label: r.line.lineRef })),
    ...sampleRows.map((s) => ({ entityType: "sample" as const, entityId: s.id, label: s.ref })),
  ]);
  const latestDieline = documentsList.find((d) => d.kind === "dieline" && d.entityType === "order");
  const arts: OpsArtwork[] = olRows.map(({ ol, line }) => {
    const versions = artRows.filter((a) => a.orderLineId === ol.id);
    const cur = versions[0] ?? null;
    const dielineFromArt = cur?.dielineFileId ? fileDocs[cur.dielineFileId] ?? null : null;
    return {
      orderLineId: ol.id, lineRef: line.lineRef, lineName: line.name, artworkRequired: ol.artworkRequired,
      current: cur ? { id: cur.id, version: cur.version, status: cur.status, clientNote: cur.clientNote, internalNote: cur.internalNote, decidedAt: cur.decidedAt?.toISOString() ?? null, decidedByName: cur.decidedBy ? names[cur.decidedBy] ?? null : null, file: cur.fileId ? fileDocs[cur.fileId] ?? null : null } : null,
      versions: versions.map((a) => ({ id: a.id, version: a.version, status: a.status, createdAt: a.createdAt.toISOString(), file: a.fileId ? fileDocs[a.fileId] ?? null : null })),
      dieline: dielineFromArt ?? (latestDieline ? { id: latestDieline.id, filename: latestDieline.filename, kind: latestDieline.kind, visibility: latestDieline.visibility, bytes: latestDieline.bytes, downloadUrl: latestDieline.downloadUrl, uploadedAt: latestDieline.uploadedAt } : null),
    };
  });
  const pos: OpsPurchaseOrder[] = poRows.map(({ po, s }) => ({
    id: po.id, ref: po.ref, supplierId: s.id, supplierName: s.legalName, supplierRef: s.ref, contactName: contacts.find((c) => c.supplierId === s.id && c.isPrimary)?.name ?? contacts.find((c) => c.supplierId === s.id)?.name ?? null,
    factoryTotalMinor: po.factoryTotalMinor, currency: po.currency, terms: po.terms, exworksEta: po.exworksEta, status: po.status, issuedAt: po.issuedAt?.toISOString() ?? null, document: po.documentId ? docs[po.documentId] ?? null : null,
    factoryLabel: ranges.find((r) => (r.supplierId as unknown as string) === s.id)?.label ?? null, disclosed: s.disclosedToOrgIds.includes(o.orgId), lineRefs: lines.filter((l) => l.poId === po.id).map((l) => l.lineRef),
  }));
  const insps: OpsInspection[] = inspRows.map((i) => ({ id: i.id, poRef: i.poId ? poById.get(i.poId as unknown as string)?.po.ref ?? null : null, inspector: i.inspector, scheduledFor: i.scheduledFor, inspectedAt: i.inspectedAt?.toISOString() ?? null, aql: i.aql, sampleSize: i.sampleSize, result: i.result, defectsNote: i.defectsNote, visibleToClient: i.visibleToClient, report: i.reportDocumentId ? docs[i.reportDocumentId] ?? null : null, createdAt: i.createdAt.toISOString() }));
  const shipment: OpsShipment | null = ship ? { id: ship.id, forwarder: ship.forwarder, forwarderParty: ship.forwarderParty, forwarderContact: ship.forwarderContact, bookingRef: ship.bookingRef, mode: ship.mode, containerOrAwb: ship.containerOrAwb, cargoReady: ship.cargoReady, exworksShippedAt: ship.exworksShippedAt?.toISOString() ?? null, etd: ship.etd, etaPort: ship.etaPort, portOfDischarge: ship.portOfDischarge, arrivedPortAt: ship.arrivedPortAt?.toISOString() ?? null, customsStatus: ship.customsStatus, deliveredAt: ship.deliveredAt?.toISOString() ?? null, bl: ship.blDocumentId ? docs[ship.blDocumentId] ?? null : null, packingList: ship.packingListDocumentId ? docs[ship.packingListDocumentId] ?? null : null } : null;

  const timeline = await loadOrderTimeline(db, o.id, documentsList);

  const depositAndFeePaid = pays.filter((p) => p.kind === "deposit" || p.kind === "fee").every((p) => p.status !== "pending");
  const balancePaid = pays.filter((p) => p.kind === "balance").every((p) => p.status !== "pending");
  const artworkNeeded = lines.some((l) => l.artworkRequired);
  const artworkApproved = arts.every((a) => !a.artworkRequired || a.current?.status === "approved");
  const exworksEta = pos.map((p) => p.exworksEta).filter((x): x is string => !!x).sort()[0] ?? null;
  const waiting = waitingOn({ state: o.state, exception: o.exception, payments: pays, artworks: arts.map((a) => (!a.artworkRequired ? { status: "approved" as const } : a.current ? { status: a.current.status } : null)) });
  const stale = isStale({ state: o.state, exception: o.exception, payments: pays, artworks: [], lastStateChangeAt: o.lastStateChangeAt });
  const nextPending = pays.find((p) => p.status === "pending");
  const sampleSkipped = sampleRows.length === 0;

  return {
    order: {
      id: o.id, ref: o.ref, orgId: o.orgId, orgName: row.orgName, requestId: o.requestId, requestRef: row.requestRef, commercialMode: o.commercialMode, pricingDisplay: o.pricingDisplay, incoterm: o.incoterm, port: o.port, piNumber: o.piNumber,
      state: o.state, milestone: o.milestone, milestoneStep: milestoneStep(o.milestone), exception: o.exception, exceptionReason: o.exceptionReason, confirmedAt: o.confirmedAt?.toISOString() ?? null, deliveredAt: o.deliveredAt?.toISOString() ?? null, completedAt: o.completedAt?.toISOString() ?? null,
      totalMinor: o.totalMinor, currency: o.currency, depositPct: o.depositPct, agentName: o.assignedAgentId ? names[o.assignedAgentId] ?? null : null, agentId: o.assignedAgentId, lastChangeAt: o.lastStateChangeAt.toISOString(), stale, waiting,
      allowedTransitions: allowedOrderTransitions(o.state), primaryAction: primaryActionFor({ state: o.state, exception: o.exception, depositAndFeePaid, artworkNeeded, artworkApproved, balancePaid }),
      exworksEta, etaPort: ship?.etaPort ?? null, portOfDischarge: ship?.portOfDischarge ?? null, sampleSkipped, name: lines[0]?.name ?? o.ref, depositAndFeePaid, balancePaid,
      nextPayment: nextPending ? { kind: nextPending.kind, amountMinor: nextPending.amountMinor, currency: nextPending.currency, dueOn: nextPending.dueOn } : null, isAdmin: isAdmin(ctx),
    },
    lines, payments: pays, artworks: arts, purchaseOrders: pos, inspections: insps, shipment, documents: documentsList, timeline,
  };
}

async function loadOrderTimeline(db: DbOrTx, orderId: string, docs: OpsDocumentRow[]): Promise<OpsTimelineEntry[]> {
  const [evs, cms] = await Promise.all([
    db.select().from(activityEvents).where(and(eq(activityEvents.entityType, "order"), eq(activityEvents.entityId, orderId))).orderBy(desc(activityEvents.createdAt)).limit(300),
    db.select().from(comments).where(and(eq(comments.entityType, "order"), eq(comments.entityId, orderId), isNull(comments.deletedAt))).orderBy(desc(comments.createdAt)),
  ]);
  const docById = new Map(docs.map((d) => [d.id, d]));
  const entries: OpsTimelineEntry[] = [
    ...evs.map((e): OpsTimelineEntry => {
      const p = e.payload as Record<string, unknown>;
      const isMilestone = e.type === "state_changed" || e.type === "state_overridden" || e.type === "order_confirmed" || e.type === "inspection_recorded" || e.type === "delivery_confirmed";
      const kind: OpsTimelineEntry["kind"] = isMilestone ? (p.milestoneChanged === true && ["price_ready", "sample", "order_confirmed", "quality_check", "delivered"].includes(String(p.milestone)) ? "action_milestone" : "milestone") : e.type === "document_published" || e.type === "document_uploaded" ? "document" : e.type === "eta_changed" || e.type === "po_updated" || e.type === "shipment_updated" || e.type === "leak_check_blocked" || e.type === "document_unpublished" ? "system" : "milestone";
      const title = e.visibility === "client" ? eventText(e.type, p) : opsEventText(e.type, p);
      const docId = typeof p.documentId === "string" ? p.documentId : null;
      const doc = docId ? docById.get(docId) : undefined;
      return { id: e.id, kind, at: e.createdAt.toISOString(), title, body: null, author: e.actorName, visibility: e.visibility, counterparty: null, type: e.type, attachments: doc ? [{ id: doc.id, name: doc.filename, href: doc.downloadUrl }] : [] };
    }),
    ...cms.map((c): OpsTimelineEntry => ({
      id: c.id, kind: c.source === "whatsapp_log" ? "whatsapp" : c.kind === "question" ? "question" : "note", at: c.createdAt.toISOString(), title: null, body: c.body, author: c.authorName, visibility: c.visibility, counterparty: c.counterparty, type: `comment:${c.kind}`,
      attachments: c.attachments.map((id) => docById.get(id)).filter((d): d is OpsDocumentRow => !!d).map((d) => ({ id: d.id, name: d.filename, href: d.downloadUrl })),
    })),
  ];
  return collapseOpsFeed(entries.sort((a, b) => b.at.localeCompare(a.at)));
}

function opsEventText(type: string, p: Record<string, unknown>): string {
  const s = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : null);
  switch (type) {
    case "po_updated": return s("note") ?? `PO ${s("poRef") ?? ""} ${s("status") ?? "updated"}${s("supplierName") ? ` — ${s("supplierName")}` : ""}`.trim();
    case "shipment_updated": return s("note") ?? `Shipment updated${s("forwarder") ? ` — ${s("forwarder")}` : ""}`;
    case "leak_check_blocked": return `Publish blocked — ${s("filename") ?? "document"} names a supplier`;
    case "document_uploaded": return `Uploaded ${s("filename") ?? "document"} (internal)`;
    case "document_unpublished": return `${p.deleted ? "Deleted" : "Unpublished"} ${s("filename") ?? "document"}`;
    case "inspection_recorded": return s("text") ?? `Inspection ${s("result") ?? "updated"}`;
    case "comment_posted": return "Note";
    case "whatsapp_logged": return "WhatsApp logged";
    case "line_assigned": return `Assigned to ${s("agentName") ?? ""}`.trim();
    default: return s("text") ?? label("activityType", type);
  }
}

/* ═══════════════════════════ confirm order (create from accepted offers) ═══════════════════════════ */

export type ConfirmLine = { requestLineId: string; lineRef: string; name: string; qty: number; unit: string; unitPriceMinorE2: number | null; feeMinor: number; factoryUnitPriceMinorE2: number | null; currency: string; incoterm: string | null; port: string | null; supplierId: string | null; supplierName: string | null; supplierRef: string | null; artworkRequired: boolean; specVersion: number | null; offerRef: string | null; option: string | null; state: LineState; eligible: boolean };
export type ConfirmContext = { requestId: string; requestRef: string; orgId: string; orgName: string; orderRef: string; defaults: { commercialMode: CommercialMode; pricingDisplay: PricingDisplay; depositPct: number; incoterm: string; port: string | null; piNumber: string; feeMinor: number }; lines: ConfirmLine[] };

export async function getConfirmOrderContext(ctx: Ctx, p: { lineRef?: string; requestRef?: string }): Promise<ConfirmContext> {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  return loadConfirmContext(await getDb(), p);
}

async function loadConfirmContext(db: DbOrTx, p: { lineRef?: string; requestRef?: string }): Promise<ConfirmContext> {
  let requestId: string | null = null;
  if (p.lineRef) {
    const [l] = await db.select({ requestId: requestLines.requestId }).from(requestLines).where(eq(requestLines.lineRef, p.lineRef)).limit(1);
    requestId = l?.requestId ?? null;
  } else if (p.requestRef) {
    const [r] = await db.select({ id: requests.id }).from(requests).where(eq(requests.ref, p.requestRef)).limit(1);
    requestId = r?.id ?? null;
  }
  if (!requestId) throw new NotFound("request");
  const [req] = await db.select({ r: requests, org: organizations }).from(requests).innerJoin(organizations, eq(organizations.id, requests.orgId)).where(eq(requests.id, requestId)).limit(1);
  if (!req) throw new NotFound("request");
  const lines = await db.select().from(requestLines).where(and(eq(requestLines.requestId, requestId), isNull(requestLines.deletedAt))).orderBy(asc(requestLines.lineNo));
  const lineIds = lines.map((l) => l.id);
  const offerRows = lineIds.length ? await db.select().from(offers).where(and(inArray(offers.requestLineId, lineIds), eq(offers.status, "accepted"), isNull(offers.deletedAt))).orderBy(desc(offers.version)) : [];
  const optionIds = offerRows.map((o) => o.acceptedOptionId).filter((x): x is string => !!x);
  const options = optionIds.length ? await db.select().from(offerOptions).where(inArray(offerOptions.id, optionIds)) : [];
  const partIds = [...new Set([...options.map((o) => o.participationId), ...lines.map((l) => l.selectedParticipationId)].filter((x): x is NonNullable<typeof x> => !!x))] as unknown as string[];
  const parts = partIds.length ? await db.select({ p: supplierParticipations, s: suppliers }).from(supplierParticipations).innerJoin(suppliers, eq(suppliers.id, supplierParticipations.supplierId)).where(inArray(supplierParticipations.id, partIds)) : [];
  const existingOrders = await db.select({ id: orders.id }).from(orders).where(and(eq(orders.requestId, requestId), isNull(orders.deletedAt)));
  const orderRef = orderRefFromRequest(req.r.ref, existingOrders.length);
  const out: ConfirmLine[] = lines.map((l) => {
    const offer = offerRows.find((o) => o.requestLineId === l.id) ?? null;
    const opt = offer?.acceptedOptionId ? options.find((x) => x.id === offer.acceptedOptionId) ?? null : null;
    const partId = (opt?.participationId ?? l.selectedParticipationId) as unknown as string | null;
    const part = partId ? parts.find((x) => x.p.id === partId) ?? null : null;
    return {
      requestLineId: l.id, lineRef: l.lineRef, name: l.name, qty: l.qtyFirst ?? 0, unit: l.unit, unitPriceMinorE2: unitPriceAtQty(opt?.priceBreaks, l.qtyFirst), feeMinor: opt?.feeMinor ?? 0, factoryUnitPriceMinorE2: opt?.factoryPriceMinorE2 ?? null,
      currency: offer?.currency ?? "USD", incoterm: offer?.incoterm ?? null, port: offer?.port ?? null, supplierId: part?.s.id ?? null, supplierName: part?.s.legalName ?? null, supplierRef: part?.s.ref ?? null, artworkRequired: l.artworkRequired, specVersion: l.specVersion, offerRef: offer?.ref ?? null, option: opt?.label ?? null, state: l.state,
      eligible: l.state === "offer_accepted" && !!opt && !!part && (l.qtyFirst ?? 0) > 0,
    };
  });
  const first = out.find((l) => l.eligible);
  return {
    requestId, requestRef: req.r.ref, orgId: req.org.id, orgName: req.org.name, orderRef,
    defaults: { commercialMode: req.org.commercialMode, pricingDisplay: req.org.pricingDisplay, depositPct: req.org.depositPct, incoterm: first?.incoterm ?? req.org.defaultIncoterm, port: first?.port ?? null, piNumber: mkPiNumber(orderRef), feeMinor: out.filter((l) => l.eligible).reduce((s, l) => s + l.feeMinor, 0) },
    lines: out,
  };
}

export type CreateOrderInput = { requestId: string; lines: { requestLineId: string; artworkRequired: boolean }[]; commercialMode: CommercialMode; pricingDisplay: PricingDisplay; incoterm: string; port: string | null; piNumber: string | null; depositPct: number; feeMinor: number };

/** SPEC F-22 "Confirm order": orders + order_lines + payments + purchase_orders per supplier; lines → order_confirmed. */
export async function createOrderFromAccepted(ctx: Ctx, input: CreateOrderInput): Promise<{ orderId: string; ref: string }> {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const db = await getDb();
  return db.transaction(async (tx) => {
    const at = now();
    const [req] = await tx.select().from(requests).where(eq(requests.id, input.requestId)).limit(1);
    if (!req) throw new NotFound("request");
    const ctxLines = (await loadConfirmContext(tx, { requestRef: req.ref })).lines;
    const chosen = input.lines.map((sel) => ({ sel, cl: ctxLines.find((l) => l.requestLineId === sel.requestLineId) })).filter((x): x is { sel: CreateOrderInput["lines"][number]; cl: ConfirmLine } => !!x.cl && x.cl.eligible);
    if (!chosen.length) throw new OrderError("E_NO_ELIGIBLE_LINES");
    const existing = await tx.select({ id: orders.id }).from(orders).where(and(eq(orders.requestId, req.id), isNull(orders.deletedAt)));
    const ref = orderRefFromRequest(req.ref, existing.length);
    const orderId = uuidv7();
    const goods = chosen.reduce((s, { cl }) => s + lineTotalMinor(cl.qty, cl.unitPriceMinorE2 ?? 0), 0);
    const total = goods + input.feeMinor;
    const [firstLine] = await tx.select({ agent: requestLines.assignedAgentId }).from(requestLines).where(eq(requestLines.id, chosen[0].cl.requestLineId)).limit(1);
    const piNumber = input.piNumber?.trim() || mkPiNumber(ref);
    await tx.insert(orders).values({ id: orderId, ref, orgId: req.orgId, requestId: req.id, offerId: null, commercialMode: input.commercialMode, pricingDisplay: input.pricingDisplay, incoterm: input.incoterm, port: input.port, piNumber, state: "order_confirmed", milestone: "order_confirmed", confirmedAt: at, totalMinor: total, currency: chosen[0].cl.currency, depositPct: input.depositPct, assignedAgentId: firstLine?.agent ?? ctx.userId, lastStateChangeAt: at, createdBy: ctx.userId, createdAt: at, updatedAt: at });
    // purchase orders per distinct supplier
    const bySupplier = new Map<string, { cl: ConfirmLine; sel: CreateOrderInput["lines"][number] }[]>();
    for (const c of chosen) bySupplier.set(c.cl.supplierId!, [...(bySupplier.get(c.cl.supplierId!) ?? []), c]);
    const poIdBySupplier = new Map<string, string>();
    let n = 1;
    for (const [supplierId, group] of bySupplier) {
      const poId = uuidv7();
      const factoryTotal = group.reduce((s, { cl }) => s + lineTotalMinor(cl.qty, cl.factoryUnitPriceMinorE2 ?? cl.unitPriceMinorE2 ?? 0), 0);
      const [q] = group[0].cl.supplierId ? await tx.select({ terms: quotes.paymentTerms }).from(quotes).innerJoin(supplierParticipations, eq(supplierParticipations.id, quotes.participationId)).where(and(eq(supplierParticipations.supplierId, supplierId), eq(supplierParticipations.requestLineId, group[0].cl.requestLineId))).orderBy(desc(quotes.version)).limit(1) : [];
      await tx.insert(purchaseOrders).values({ id: poId, ref: mkPoRef(ref, n++), orgId: req.orgId, orderId, supplierId, factoryTotalMinor: factoryTotal, currency: group[0].cl.currency, terms: q?.terms ?? null, status: "draft", createdBy: ctx.userId, createdAt: at, updatedAt: at });
      poIdBySupplier.set(supplierId, poId);
    }
    // order lines + fee distribution (option fees; any edited remainder lands on the first line)
    const optionFees = chosen.reduce((s, { cl }) => s + cl.feeMinor, 0);
    let remainder = input.feeMinor - optionFees;
    let lineNo = 1;
    for (const { cl, sel } of chosen) {
      const fee = cl.feeMinor + (remainder !== 0 ? remainder : 0);
      remainder = 0;
      const [line] = await tx.select({ productId: requestLines.productId, sel: requestLines.selectedParticipationId }).from(requestLines).where(eq(requestLines.id, cl.requestLineId)).limit(1);
      await tx.insert(orderLines).values({ id: uuidv7(), orderId, requestLineId: cl.requestLineId, productId: line?.productId ?? null, specVersion: cl.specVersion, lineNo: lineNo++, qty: cl.qty, unit: cl.unit, unitPriceMinorE2: cl.unitPriceMinorE2 ?? 0, feeMinor: fee, factoryUnitPriceMinorE2: cl.factoryUnitPriceMinorE2, participationId: line?.sel ?? null, poId: poIdBySupplier.get(cl.supplierId!) as never, artworkRequired: sel.artworkRequired, createdAt: at });
      // QA-04: the line mirror is history-only (the order event below is the one feed item) and never claims an invoice
      await transition(cl.requestLineId, "order_confirmed", ctx, { tx, at, notifyClient: false, payload: { orderRef: ref, feed: false } });
    }
    // QA-04: no due date until the PI is published (publishOrderDocument sets deposit/fee due = publish + 5 working days)
    for (const p of paymentPlan({ goodsMinor: goods, feeMinor: input.feeMinor, depositPct: input.depositPct, commercialMode: input.commercialMode })) {
      await tx.insert(payments).values({ id: uuidv7(), orgId: req.orgId, orderId, kind: p.kind, pct: p.pct, amountMinor: p.amountMinor, currency: chosen[0].cl.currency, payee: p.payee, status: "pending", dueOn: null, createdBy: ctx.userId, createdAt: at, updatedAt: at });
    }
    await tx.update(requests).set({ status: "active", updatedAt: at }).where(eq(requests.id, req.id));
    // QA-04: ONE client-visible "Order confirmed" event (the lines' mirror events are history-only); the invoice is announced when the PI is published
    await logActivity(tx, { orgId: req.orgId, entityType: "order", entityId: orderId, type: "order_confirmed", actorId: ctx.userId, actorName: ctx.name, visibility: "client", at, payload: { ref, milestone: "order_confirmed", text: ORDER_CONFIRMED_TEXT } });
    for (const u of await clientUsersOf(tx, req.orgId)) {
      await enqueue({ userId: u.id, toEmail: u.email, template: "client_order_confirmed", entityRef: ref, subject: `Order confirmed — ${ref}`, payload: { ref, piNumber, total: formatMoney({ minor: total, currency: chosen[0].cl.currency }), url: `/app/orders/${ref}` }, idempotencyKey: `client_order_confirmed:${orderId}:${u.id}`, at }, tx);
    }
    return { orderId, ref };
  });
}

/* ═══════════════════════════ shared internals ═══════════════════════════ */

async function lockOrder(tx: DbOrTx, orderId: string) {
  const [o] = await tx.select().from(orders).where(and(eq(orders.id, orderId), isNull(orders.deletedAt))).for("update");
  if (!o) throw new NotFound("order");
  return o;
}

async function notifyClients(tx: DbOrTx, o: { id: string; orgId: string; ref: string }, template: Parameters<typeof enqueue>[0]["template"], subject: string, payload: Record<string, unknown>, discriminator: string, at: Date) {
  for (const u of await clientUsersOf(tx, o.orgId)) {
    await enqueue({ userId: u.id, toEmail: u.email, template, entityRef: o.ref, subject, payload: { ref: o.ref, url: `/app/orders/${o.ref}`, ...payload }, idempotencyKey: `${template}:${o.id}:${discriminator}:${u.id}`, at }, tx);
  }
}

const orgName = async (tx: DbOrTx, orgId: string) => (await tx.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, orgId)).limit(1))[0]?.name ?? "Client";

/* ═══════════════════════════ state ═══════════════════════════ */

/** "Change state" sheet: a plain table transition (agent) or an admin override with a mandatory reason. */
export async function changeOrderState(ctx: Ctx, orderId: string, to: State, opts: { note?: string; overrideReason?: string }) {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  if (opts.overrideReason && !isAdmin(ctx)) throw new Forbidden("admin only");
  const db = await getDb();
  return db.transaction(async (tx) => {
    const o = await lockOrder(tx, orderId);
    const at = now();
    const r = await transitionOrder(orderId, to, ctx, { tx, at, note: opts.note, override: opts.overrideReason ? { reason: opts.overrideReason } : undefined, clearException: to === "qc_inspection" && o.exception === "qc_failed", notifyClient: to !== "delivered" });
    if (to === "delivered") await notifyClients(tx, o, "client_delivery_confirm", `Delivered — please confirm ${o.ref}`, { deliveredAt: at.toISOString() }, "delivered", at);
    if (to === "completed") {
      await recordSupplierPerformance(tx, o.id, at);
      await notifyClients(tx, o, "client_milestone_changed", `${o.ref}: Delivered — completed`, { name: o.ref, milestone: "delivered", completed: true }, `completed:${at.toISOString()}`, at);
    }
    return r;
  });
}

export async function setOrderException(ctx: Ctx, orderId: string, exception: LineException | null, reason?: string) {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const db = await getDb();
  if (exception === "on_hold" && reason) assertClean({ text: reason }, await loadLeakSources(db));
  await setException({ orderId }, exception, ctx, { reason });
}

/* ═══════════════════════════ payments ═══════════════════════════ */

export async function markPaymentPaid(ctx: Ctx, paymentId: string, p: { reference: string; paidAt?: string }) {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [pay] = await tx.select().from(payments).where(and(eq(payments.id, paymentId), isNull(payments.deletedAt))).for("update");
    if (!pay || !pay.orderId) throw new NotFound("payment");
    if (pay.status === "paid") return { orderRef: null as string | null, transitioned: null as State | null };
    const o = await lockOrder(tx, pay.orderId);
    const at = now();
    const paidAt = p.paidAt ? new Date(`${p.paidAt}T09:00:00Z`) : at;
    await tx.update(payments).set({ status: "paid", paidAt, reference: p.reference.trim(), recordedBy: ctx.userId, updatedAt: at }).where(eq(payments.id, paymentId));
    const kindLabel = pay.kind[0].toUpperCase() + pay.kind.slice(1);
    await logActivity(tx, { orgId: o.orgId, entityType: "order", entityId: o.id, type: "payment_recorded", actorId: ctx.userId, actorName: ctx.name, visibility: "client", at, payload: { ref: o.ref, kind: pay.kind, amount: formatMoney({ minor: pay.amountMinor, currency: pay.currency }), text: `${kindLabel} received — ${formatMoney({ minor: pay.amountMinor, currency: pay.currency })}` } });
    let transitioned: State | null = null;
    if (o.state === "awaiting_deposit") {
      const rest = await tx.select().from(payments).where(and(eq(payments.orderId, o.id), inArray(payments.kind, ["deposit", "fee"]), eq(payments.status, "pending"), isNull(payments.deletedAt)));
      const ols = await tx.select({ art: orderLines.artworkRequired }).from(orderLines).where(eq(orderLines.orderId, o.id));
      if (!rest.length && ols.some((l) => l.art)) {
        await transitionOrder(o.id, "awaiting_artwork", ctx, { tx, at: new Date(at.getTime() + 1000), notifyClient: false });
        await notifyClients(tx, o, "client_artwork_requested", `Artwork needed for ${o.ref}`, { url: `/app/orders/${o.ref}#artwork` }, "requested", at);
        transitioned = "awaiting_artwork";
      }
    }
    return { orderRef: o.ref, transitioned };
  });
}

export async function setPaymentDueDate(ctx: Ctx, paymentId: string, dueOn: string | null) {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [pay] = await tx.select().from(payments).where(and(eq(payments.id, paymentId), isNull(payments.deletedAt))).for("update");
    if (!pay || !pay.orderId) throw new NotFound("payment");
    const o = await lockOrder(tx, pay.orderId);
    const at = now();
    await tx.update(payments).set({ dueOn, updatedAt: at }).where(eq(payments.id, paymentId));
    await logActivity(tx, { orgId: o.orgId, entityType: "order", entityId: o.id, type: "payment_recorded", actorId: ctx.userId, actorName: ctx.name, visibility: "internal", at, payload: { ref: o.ref, kind: pay.kind, dueOn, text: `${pay.kind} due date set to ${dueOn ? formatDate(dueOn) : "—"}` } });
    return { orderRef: o.ref };
  });
}

export async function addPayment(ctx: Ctx, orderId: string, p: { kind: PaymentKind; amountMinor: number; dueOn: string | null; payee: Payee }) {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const db = await getDb();
  return db.transaction(async (tx) => {
    const o = await lockOrder(tx, orderId);
    const at = now();
    await tx.insert(payments).values({ id: uuidv7(), orgId: o.orgId, orderId: o.id, kind: p.kind, amountMinor: p.amountMinor, currency: o.currency, payee: p.payee, status: "pending", dueOn: p.dueOn, createdBy: ctx.userId, createdAt: at, updatedAt: at });
    await logActivity(tx, { orgId: o.orgId, entityType: "order", entityId: o.id, type: "payment_recorded", actorId: ctx.userId, actorName: ctx.name, visibility: "internal", at, payload: { ref: o.ref, kind: p.kind, text: `${p.kind} payment added — ${formatMoney({ minor: p.amountMinor, currency: o.currency })}` } });
    return { orderRef: o.ref };
  });
}

export async function waivePayment(ctx: Ctx, paymentId: string) {
  if (!isAdmin(ctx)) throw new Forbidden("admin only");
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [pay] = await tx.select().from(payments).where(and(eq(payments.id, paymentId), isNull(payments.deletedAt))).for("update");
    if (!pay || !pay.orderId) throw new NotFound("payment");
    const o = await lockOrder(tx, pay.orderId);
    const at = now();
    await tx.update(payments).set({ status: "waived", recordedBy: ctx.userId, updatedAt: at }).where(eq(payments.id, paymentId));
    await logActivity(tx, { orgId: o.orgId, entityType: "order", entityId: o.id, type: "payment_recorded", actorId: ctx.userId, actorName: ctx.name, visibility: "internal", at, payload: { ref: o.ref, kind: pay.kind, text: `${pay.kind} waived` } });
    return { orderRef: o.ref };
  });
}

/* ═══════════════════════════ artwork ═══════════════════════════ */

export async function decideArtwork(ctx: Ctx, artworkId: string, decision: "approved" | "changes_requested", note?: string) {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [art] = await tx.select({ a: artworks, ol: orderLines }).from(artworks).innerJoin(orderLines, eq(orderLines.id, artworks.orderLineId)).where(and(eq(artworks.id, artworkId), isNull(artworks.deletedAt))).for("update");
    if (!art) throw new NotFound("artwork");
    const o = await lockOrder(tx, art.ol.orderId);
    const at = now();
    if (decision === "changes_requested") {
      if (!note || note.trim().length < 5) throw new OrderError("E_NOTE_REQUIRED");
      assertClean({ text: note }, await loadLeakSources(tx));
    }
    await tx.update(artworks).set({ status: decision, decidedAt: at, decidedBy: ctx.userId, approvedBy: decision === "approved" ? ctx.userId : null, internalNote: decision === "changes_requested" ? note ?? null : art.a.internalNote, updatedAt: at }).where(eq(artworks.id, artworkId));
    const text = decision === "approved" ? "Artwork approved" : `Artwork changes requested — ${note!.trim()}`;
    await logActivity(tx, { orgId: o.orgId, entityType: "order", entityId: o.id, type: "artwork_decided", actorId: ctx.userId, actorName: ctx.name, visibility: "client", at, payload: { ref: o.ref, decision, version: art.a.version, note: decision === "changes_requested" ? note!.trim() : null, text } });
    if (decision === "approved") await notifyClients(tx, o, "client_artwork_approved", "Artwork approved", { url: `/app/orders/${o.ref}#artwork` }, `${artworkId}:approved`, at);
    else await notifyClients(tx, o, "client_artwork_changes", "Artwork changes requested", { note: note!.trim(), url: `/app/orders/${o.ref}#artwork` }, `${artworkId}:changes:${at.toISOString()}`, at);
    return { orderRef: o.ref };
  });
}

export async function setArtworkRequired(ctx: Ctx, orderLineId: string, required: boolean) {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [ol] = await tx.select().from(orderLines).where(eq(orderLines.id, orderLineId)).limit(1);
    if (!ol) throw new NotFound("order line");
    const o = await lockOrder(tx, ol.orderId);
    const at = now();
    await tx.update(orderLines).set({ artworkRequired: required }).where(eq(orderLines.id, orderLineId));
    await logActivity(tx, { orgId: o.orgId, entityType: "order", entityId: o.id, type: "line_updated", actorId: ctx.userId, actorName: ctx.name, visibility: "internal", at, payload: { ref: o.ref, text: `Artwork ${required ? "required" : "not required"} on line ${ol.lineNo}` } });
    return { orderRef: o.ref };
  });
}

/** Ops dieline upload: stored internal, then published (dielines are for the client). Linked to the line's latest artwork row. */
export async function uploadDieline(ctx: Ctx, orderLineId: string, file: { filename: string; mime: string; data: Buffer }) {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [ol] = await tx.select().from(orderLines).where(eq(orderLines.id, orderLineId)).limit(1);
    if (!ol) throw new NotFound("order line");
    const o = await lockOrder(tx, ol.orderId);
    const up = await uploadDocument(ctx, { entityType: "order", entityId: o.id, orgId: o.orgId, kind: "dieline", ...file }, tx);
    const pub = await publishDocument(ctx, up.documentId, { tx, notifyClient: false });
    const [art] = await tx.select().from(artworks).where(and(eq(artworks.orderLineId, orderLineId), isNull(artworks.deletedAt))).orderBy(desc(artworks.version)).limit(1);
    if (art && !pub.blocked) await tx.update(artworks).set({ dielineFileId: up.fileId, updatedAt: now() }).where(eq(artworks.id, art.id));
    return { orderRef: o.ref, documentId: up.documentId, pub };
  }).then((r) => { throwIfBlocked(r.pub); return { orderRef: r.orderRef, documentId: r.documentId }; });
}

/* ═══════════════════════════ purchase orders + production ═══════════════════════════ */

/** Edit ex-works ETA: internal `po_updated`; when the client already had an ETA (order ≥ in_production) also `eta_changed` + `client_eta_changed`. */
export async function setPoEta(ctx: Ctx, poId: string, exworksEta: string) {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [po] = await tx.select().from(purchaseOrders).where(and(eq(purchaseOrders.id, poId), isNull(purchaseOrders.deletedAt))).for("update");
    if (!po) throw new NotFound("purchase order");
    const o = await lockOrder(tx, po.orderId);
    const at = now();
    const prev = po.exworksEta;
    await tx.update(purchaseOrders).set({ exworksEta, updatedAt: at }).where(eq(purchaseOrders.id, poId));
    await logActivity(tx, { orgId: o.orgId, entityType: "order", entityId: o.id, type: "po_updated", actorId: ctx.userId, actorName: ctx.name, visibility: "internal", at, payload: { ref: o.ref, poRef: po.ref, exworksEta, previous: prev, text: `${po.ref} ex-works ETA ${prev ? `${formatDate(prev)} → ` : ""}${formatDate(exworksEta)}` } });
    const clientSaw = !!prev && ["in_production", "qc_inspection", "awaiting_balance", "forwarder_booked"].includes(o.state);
    if (clientSaw && prev !== exworksEta) {
      await logActivity(tx, { orgId: o.orgId, entityType: "order", entityId: o.id, type: "eta_changed", actorId: ctx.userId, actorName: ctx.name, visibility: "client", at: new Date(at.getTime() + 1000), payload: { ref: o.ref, eta: exworksEta, text: `ETA updated — ex-works ${formatDate(exworksEta)}` } });
      await notifyClients(tx, o, "client_eta_changed", `ETA update — ${o.ref}: ${formatDate(exworksEta)}`, { eta: exworksEta, etaKind: "exworks" }, `exworks:${exworksEta}`, at);
    }
    return { orderRef: o.ref, notified: clientSaw && prev !== exworksEta };
  });
}

export async function updatePo(ctx: Ctx, poId: string, p: { terms?: string | null; factoryTotalMinor?: number; status?: PoStatus }) {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [po] = await tx.select().from(purchaseOrders).where(and(eq(purchaseOrders.id, poId), isNull(purchaseOrders.deletedAt))).for("update");
    if (!po) throw new NotFound("purchase order");
    const o = await lockOrder(tx, po.orderId);
    const at = now();
    await tx.update(purchaseOrders).set({ ...(p.terms !== undefined ? { terms: p.terms } : {}), ...(p.factoryTotalMinor !== undefined ? { factoryTotalMinor: p.factoryTotalMinor } : {}), ...(p.status ? { status: p.status, ...(p.status === "issued" && !po.issuedAt ? { issuedAt: at } : {}) } : {}), updatedAt: at }).where(eq(purchaseOrders.id, poId));
    await logActivity(tx, { orgId: o.orgId, entityType: "order", entityId: o.id, type: "po_updated", actorId: ctx.userId, actorName: ctx.name, visibility: "internal", at, payload: { ref: o.ref, poRef: po.ref, status: p.status ?? po.status, text: `${po.ref} ${p.status ? p.status.replace(/_/g, " ") : "updated"}` } });
    return { orderRef: o.ref };
  });
}

/** SPEC 3.4: awaiting_artwork|awaiting_deposit → in_production with an ex-works ETA on every PO. */
export async function startProduction(ctx: Ctx, orderId: string, p: { exworksEta: string }) {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const db = await getDb();
  return db.transaction(async (tx) => {
    const o = await lockOrder(tx, orderId);
    const at = now();
    const ols = await tx.select().from(orderLines).where(eq(orderLines.orderId, o.id));
    const arts = await tx.select().from(artworks).where(and(inArray(artworks.orderLineId, ols.map((l) => l.id)), isNull(artworks.deletedAt))).orderBy(desc(artworks.version));
    const latest = new Map<string, typeof arts[number]>();
    for (const a of arts) if (!latest.has(a.orderLineId)) latest.set(a.orderLineId, a);
    if (o.state === "awaiting_artwork" && !ols.every((l) => !l.artworkRequired || latest.get(l.id)?.status === "approved")) throw new OrderError("E_ARTWORK_NOT_APPROVED");
    if (o.state === "awaiting_deposit") {
      const pending = await tx.select().from(payments).where(and(eq(payments.orderId, o.id), inArray(payments.kind, ["deposit", "fee"]), eq(payments.status, "pending"), isNull(payments.deletedAt)));
      if (pending.length) throw new OrderError("E_PAYMENTS_PENDING");
      if (ols.some((l) => l.artworkRequired)) throw new OrderError("E_ARTWORK_REQUIRED");
    }
    // QA-25: a PO that goes into production has been issued (draft → issued is recorded, not skipped)
    await tx.update(purchaseOrders).set({ issuedAt: at }).where(and(eq(purchaseOrders.orderId, o.id), isNull(purchaseOrders.deletedAt), isNull(purchaseOrders.issuedAt)));
    await tx.update(purchaseOrders).set({ exworksEta: p.exworksEta, status: "in_production", updatedAt: at }).where(and(eq(purchaseOrders.orderId, o.id), isNull(purchaseOrders.deletedAt)));
    await transitionOrder(o.id, "in_production", ctx, { tx, at, notifyClient: false, payload: { eta: p.exworksEta, text: `In production — ex-works ETA ${formatDate(p.exworksEta)}` } });
    await notifyClients(tx, o, "client_milestone_changed", `${o.ref}: In production — ex-works ETA ${formatDate(p.exworksEta)}`, { name: o.ref, milestone: "in_production", eta: p.exworksEta }, `in_production:${at.toISOString()}`, at);
    return { orderRef: o.ref };
  });
}

/* ═══════════════════════════ inspection ═══════════════════════════ */

export async function scheduleInspection(ctx: Ctx, orderId: string, p: { scheduledFor: string; inspector: string | null; aql: string | null; sampleSize: number | null; inspectionId?: string }) {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const db = await getDb();
  return db.transaction(async (tx) => {
    const o = await lockOrder(tx, orderId);
    const at = now();
    const [po] = await tx.select({ id: purchaseOrders.id }).from(purchaseOrders).where(and(eq(purchaseOrders.orderId, o.id), isNull(purchaseOrders.deletedAt))).limit(1);
    let id = p.inspectionId ?? null;
    if (id) await tx.update(inspections).set({ scheduledFor: p.scheduledFor, inspector: p.inspector, aql: p.aql, sampleSize: p.sampleSize, updatedAt: at }).where(eq(inspections.id, id));
    else {
      id = uuidv7();
      await tx.insert(inspections).values({ id, orgId: o.orgId, orderId: o.id, poId: (po?.id ?? null) as never, inspector: p.inspector, scheduledFor: p.scheduledFor, aql: p.aql, sampleSize: p.sampleSize, visibleToClient: false, createdBy: ctx.userId, createdAt: at, updatedAt: at });
    }
    await logActivity(tx, { orgId: o.orgId, entityType: "order", entityId: o.id, type: "inspection_recorded", actorId: ctx.userId, actorName: ctx.name, visibility: "client", at, payload: { ref: o.ref, scheduledFor: p.scheduledFor, text: `Inspection scheduled for ${formatDate(p.scheduledFor)}` } });
    if (o.state === "in_production") await transitionOrder(o.id, "qc_inspection", ctx, { tx, at: new Date(at.getTime() + 1000), clearException: o.exception === "qc_failed", payload: { scheduledFor: p.scheduledFor } });
    return { orderRef: o.ref, inspectionId: id };
  });
}

/** Record the result (+ optional report upload, internal). pass → awaiting_balance (+ balance due, qc result + payment due emails); fail/rework → in_production + qc_failed. */
export async function recordInspection(ctx: Ctx, inspectionId: string, p: { result: InspectionResult; inspectedAt?: string; defectsNote: string | null; aql?: string | null; sampleSize?: number | null; report?: { filename: string; mime: string; data: Buffer } | null; visibleToClient?: boolean }) {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [insp] = await tx.select().from(inspections).where(and(eq(inspections.id, inspectionId), isNull(inspections.deletedAt))).for("update");
    if (!insp) throw new NotFound("inspection");
    const o = await lockOrder(tx, insp.orderId);
    const at = now();
    const inspectedAt = p.inspectedAt ? new Date(`${p.inspectedAt}T09:00:00Z`) : at;
    let reportDocumentId = insp.reportDocumentId;
    if (p.report) reportDocumentId = (await uploadDocument(ctx, { entityType: "order", entityId: o.id, orgId: o.orgId, kind: "qc_report", ...p.report }, tx)).documentId;
    await tx.update(inspections).set({ result: p.result, inspectedAt, defectsNote: p.defectsNote, aql: p.aql ?? insp.aql, sampleSize: p.sampleSize ?? insp.sampleSize, reportDocumentId, visibleToClient: p.visibleToClient ?? insp.visibleToClient, updatedAt: at }).where(eq(inspections.id, inspectionId));
    const passText = `Quality check passed${p.defectsNote ? ` — ${p.defectsNote}` : ""}`;
    const failText = "Quality check: rework in progress";
    await logActivity(tx, { orgId: o.orgId, entityType: "order", entityId: o.id, type: "inspection_recorded", actorId: ctx.userId, actorName: ctx.name, visibility: "client", at, payload: { ref: o.ref, result: p.result, text: p.result === "pass" ? passText : failText } });
    if (p.result === "pass") {
      const dueOn = toIsoDate(addWorkingDays(at, 3));
      const bal = await tx.select().from(payments).where(and(eq(payments.orderId, o.id), eq(payments.kind, "balance"), eq(payments.status, "pending"), isNull(payments.deletedAt)));
      for (const b of bal) await tx.update(payments).set({ dueOn, updatedAt: at }).where(eq(payments.id, b.id));
      // AC-OO-03: a pass recorded while still `in_production` (inspection scheduled but the state not advanced) walks
      // in_production → qc_inspection → awaiting_balance in one action.
      if (o.state === "in_production") await transitionOrder(o.id, "qc_inspection", ctx, { tx, at: new Date(at.getTime() + 500), notifyClient: false, clearException: o.exception === "qc_failed" });
      if (o.state === "qc_inspection" || o.state === "in_production") await transitionOrder(o.id, "awaiting_balance", ctx, { tx, at: new Date(at.getTime() + 1000), notifyClient: false });
      await notifyClients(tx, o, "client_qc_result", `Quality check passed — ${o.ref}`, { result: "pass", url: `/app/orders/${o.ref}#qc` }, `pass:${inspectionId}`, at);
      const amount = bal.reduce((s, b) => s + b.amountMinor, 0);
      if (amount > 0) await notifyClients(tx, o, "client_payment_due", `Payment due — balance ${formatMoney({ minor: amount, currency: o.currency })} for ${o.ref}`, { kind: "balance", amount: formatMoney({ minor: amount, currency: o.currency }), dueOn, url: `/app/orders/${o.ref}#payments` }, `balance:${inspectionId}`, at);
    } else {
      if (o.state === "qc_inspection") await transitionOrder(o.id, "in_production", ctx, { tx, at: new Date(at.getTime() + 1000), notifyClient: false });
      await setException({ orderId: o.id }, "qc_failed", ctx, { tx, at: new Date(at.getTime() + 2000), reason: p.defectsNote ?? undefined });
      await tx.update(purchaseOrders).set({ status: "in_production", updatedAt: at }).where(and(eq(purchaseOrders.orderId, o.id), isNull(purchaseOrders.deletedAt)));
      await notifyClients(tx, o, "client_qc_result", "Quality check: rework in progress", { result: p.result, text: "Rework in progress — no action needed", url: `/app/orders/${o.ref}#qc` }, `${p.result}:${inspectionId}:${at.toISOString()}`, at);
    }
    return { orderRef: o.ref, reportDocumentId };
  });
}

export async function setInspectionVisibility(ctx: Ctx, inspectionId: string, visible: boolean) {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [insp] = await tx.select().from(inspections).where(and(eq(inspections.id, inspectionId), isNull(inspections.deletedAt))).for("update");
    if (!insp) throw new NotFound("inspection");
    const o = await lockOrder(tx, insp.orderId);
    const at = now();
    await tx.update(inspections).set({ visibleToClient: visible, updatedAt: at }).where(eq(inspections.id, inspectionId));
    await logActivity(tx, { orgId: o.orgId, entityType: "order", entityId: o.id, type: "inspection_recorded", actorId: ctx.userId, actorName: ctx.name, visibility: "internal", at, payload: { ref: o.ref, visibleToClient: visible, text: `Inspection ${visible ? "shown to" : "hidden from"} the client` } });
    return { orderRef: o.ref };
  });
}

/* ═══════════════════════════ shipment ═══════════════════════════ */

async function upsertShipment(tx: DbOrTx, o: { id: string; orgId: string }, patch: Partial<typeof shipments.$inferInsert>, ctx: Ctx, at: Date) {
  const [s] = await tx.select().from(shipments).where(and(eq(shipments.orderId, o.id), isNull(shipments.deletedAt))).orderBy(desc(shipments.createdAt)).limit(1);
  if (s) { await tx.update(shipments).set({ ...patch, updatedAt: at }).where(eq(shipments.id, s.id)); return { id: s.id, prev: s }; }
  const id = uuidv7();
  await tx.insert(shipments).values({ id, orgId: o.orgId, orderId: o.id, customsStatus: "not_started", ...patch, createdBy: ctx.userId, createdAt: at, updatedAt: at });
  return { id, prev: null };
}

export type ForwarderInput = { forwarder: string; forwarderParty: ForwarderParty; forwarderContact: string | null; bookingRef: string; cargoReady: string; mode: ShipmentMode | null; portOfDischarge: string | null; etaPort: string | null; overrideReason?: string };

/** awaiting_balance → forwarder_booked. Balance must be paid unless an admin overrides with a reason (AC-OO-05). forwarder_party=client discloses the supplier(s). */
export async function recordForwarder(ctx: Ctx, orderId: string, p: ForwarderInput) {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const db = await getDb();
  return db.transaction(async (tx) => {
    const o = await lockOrder(tx, orderId);
    const at = now();
    const pendingBalance = await tx.select().from(payments).where(and(eq(payments.orderId, o.id), eq(payments.kind, "balance"), eq(payments.status, "pending"), isNull(payments.deletedAt)));
    if (pendingBalance.length && o.state === "awaiting_balance") {
      if (!p.overrideReason || !isAdmin(ctx)) throw new OrderError("E_BALANCE_NOT_PAID");
    }
    const { prev } = await upsertShipment(tx, o, { forwarder: p.forwarder, forwarderParty: p.forwarderParty, forwarderContact: p.forwarderContact, bookingRef: p.bookingRef, cargoReady: p.cargoReady, mode: p.mode ?? undefined, portOfDischarge: p.portOfDischarge ?? undefined, etaPort: p.etaPort ?? undefined }, ctx, at);
    await logActivity(tx, { orgId: o.orgId, entityType: "order", entityId: o.id, type: "shipment_updated", actorId: ctx.userId, actorName: ctx.name, visibility: "internal", at, payload: { ref: o.ref, forwarder: p.forwarder, forwarderParty: p.forwarderParty, bookingRef: p.bookingRef, cargoReady: p.cargoReady, override: p.overrideReason ?? null, text: `Forwarder recorded — ${p.forwarder} (${p.forwarderParty}) · booking ${p.bookingRef} · cargo ready ${formatDate(p.cargoReady)}${p.overrideReason ? ` · shipped before balance: ${p.overrideReason}` : ""}` } });
    if (p.forwarderParty === "client") {
      const pos = await tx.select({ supplierId: purchaseOrders.supplierId }).from(purchaseOrders).where(and(eq(purchaseOrders.orderId, o.id), isNull(purchaseOrders.deletedAt)));
      for (const po of pos) {
        const [s] = await tx.select({ id: suppliers.id, ref: suppliers.ref, disclosed: suppliers.disclosedToOrgIds }).from(suppliers).where(eq(suppliers.id, po.supplierId)).limit(1);
        if (s && !s.disclosed.includes(o.orgId)) {
          await tx.update(suppliers).set({ disclosedToOrgIds: [...s.disclosed, o.orgId], updatedAt: at }).where(eq(suppliers.id, s.id));
          await logActivity(tx, { orgId: o.orgId, entityType: "supplier", entityId: s.id, type: "shipment_updated", actorId: ctx.userId, actorName: ctx.name, visibility: "internal", at, payload: { note: `disclosed_to_org_ids += ${await orgName(tx, o.orgId)} (forwarder_party=client on ${o.ref})` } });
        }
      }
    }
    if (o.state === "awaiting_balance") await transitionOrder(o.id, "forwarder_booked", ctx, { tx, at: new Date(at.getTime() + 1000), payload: { cargoReady: p.cargoReady } });
    if (p.etaPort && prev?.etaPort && prev.etaPort !== p.etaPort) await etaPortChanged(tx, ctx, o, p.etaPort, at);
    return { orderRef: o.ref };
  });
}

async function etaPortChanged(tx: DbOrTx, ctx: Ctx, o: { id: string; orgId: string; ref: string }, etaPort: string, at: Date) {
  await logActivity(tx, { orgId: o.orgId, entityType: "order", entityId: o.id, type: "eta_changed", actorId: ctx.userId, actorName: ctx.name, visibility: "client", at: new Date(at.getTime() + 1500), payload: { ref: o.ref, eta: etaPort, text: `ETA updated — port ${formatDate(etaPort)}` } });
  await notifyClients(tx, o, "client_eta_changed", `ETA update — ${o.ref}: ${formatDate(etaPort)}`, { eta: etaPort, etaKind: "port" }, `port:${etaPort}`, at);
}

export async function markShippedExworks(ctx: Ctx, orderId: string, p: { exworksShippedAt: string }) {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const db = await getDb();
  return db.transaction(async (tx) => {
    const o = await lockOrder(tx, orderId);
    const at = now();
    await upsertShipment(tx, o, { exworksShippedAt: new Date(`${p.exworksShippedAt}T09:00:00Z`) }, ctx, at);
    await logActivity(tx, { orgId: o.orgId, entityType: "order", entityId: o.id, type: "shipment_updated", actorId: ctx.userId, actorName: ctx.name, visibility: "internal", at, payload: { ref: o.ref, text: `Shipped ex-works ${formatDate(p.exworksShippedAt)}` } });
    if (o.state === "forwarder_booked") await transitionOrder(o.id, "shipped_exworks", ctx, { tx, at: new Date(at.getTime() + 1000) });
    return { orderRef: o.ref };
  });
}

export async function markDeparted(ctx: Ctx, orderId: string, p: { mode: ShipmentMode; containerOrAwb: string; etd: string; etaPort: string; portOfDischarge: string | null }) {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const db = await getDb();
  return db.transaction(async (tx) => {
    const o = await lockOrder(tx, orderId);
    const at = now();
    const { prev } = await upsertShipment(tx, o, { mode: p.mode, containerOrAwb: p.containerOrAwb, etd: p.etd, etaPort: p.etaPort, ...(p.portOfDischarge ? { portOfDischarge: p.portOfDischarge } : {}) }, ctx, at);
    await logActivity(tx, { orgId: o.orgId, entityType: "order", entityId: o.id, type: "shipment_updated", actorId: ctx.userId, actorName: ctx.name, visibility: "internal", at, payload: { ref: o.ref, mode: p.mode, containerOrAwb: p.containerOrAwb, etd: p.etd, etaPort: p.etaPort, text: `Departed — ${p.mode} ${p.containerOrAwb} · ETD ${formatDate(p.etd)} · ETA ${formatDate(p.etaPort)}` } });
    if (o.state === "shipped_exworks") await transitionOrder(o.id, "departed_origin", ctx, { tx, at: new Date(at.getTime() + 1000), payload: { mode: p.mode, etd: p.etd, etaPort: p.etaPort, text: `Departed origin — ${p.mode}, ETA ${p.portOfDischarge ?? prev?.portOfDischarge ?? "port"} ${formatDate(p.etaPort)}` } });
    if (prev?.etaPort && prev.etaPort !== p.etaPort) await etaPortChanged(tx, ctx, o, p.etaPort, at);
    return { orderRef: o.ref };
  });
}

export async function markArrived(ctx: Ctx, orderId: string, p: { arrivedPortAt: string }) {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const db = await getDb();
  return db.transaction(async (tx) => {
    const o = await lockOrder(tx, orderId);
    const at = now();
    await upsertShipment(tx, o, { arrivedPortAt: new Date(`${p.arrivedPortAt}T09:00:00Z`), customsStatus: "in_progress" }, ctx, at);
    await logActivity(tx, { orgId: o.orgId, entityType: "order", entityId: o.id, type: "shipment_updated", actorId: ctx.userId, actorName: ctx.name, visibility: "internal", at, payload: { ref: o.ref, text: `Arrived at port ${formatDate(p.arrivedPortAt)} — customs in progress` } });
    if (o.state === "departed_origin") await transitionOrder(o.id, "eu_port_customs", ctx, { tx, at: new Date(at.getTime() + 1000) });
    return { orderRef: o.ref };
  });
}

export async function setCustomsStatus(ctx: Ctx, orderId: string, customsStatus: CustomsStatus) {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const db = await getDb();
  return db.transaction(async (tx) => {
    const o = await lockOrder(tx, orderId);
    const at = now();
    await upsertShipment(tx, o, { customsStatus }, ctx, at);
    await logActivity(tx, { orgId: o.orgId, entityType: "order", entityId: o.id, type: "shipment_updated", actorId: ctx.userId, actorName: ctx.name, visibility: "client", at, payload: { ref: o.ref, customsStatus, text: `Customs: ${label("customsStatus", customsStatus).toLowerCase()}` } });
    return { orderRef: o.ref };
  });
}

export async function markDelivered(ctx: Ctx, orderId: string, p: { deliveredAt: string }) {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const db = await getDb();
  return db.transaction(async (tx) => {
    const o = await lockOrder(tx, orderId);
    const at = now();
    const deliveredAt = new Date(`${p.deliveredAt}T09:00:00Z`);
    // QA-25: delivered goods have cleared customs (unless an agent flagged them held), and the factory POs are done
    const [shipRow] = await tx.select({ customsStatus: shipments.customsStatus }).from(shipments).where(and(eq(shipments.orderId, o.id), isNull(shipments.deletedAt))).limit(1);
    await upsertShipment(tx, o, { deliveredAt, ...(shipRow?.customsStatus === "held" ? {} : { customsStatus: "cleared" as const }) }, ctx, at);
    await tx.update(orders).set({ deliveredAt, updatedAt: at }).where(eq(orders.id, o.id));
    await tx.update(purchaseOrders).set({ status: "completed", updatedAt: at }).where(and(eq(purchaseOrders.orderId, o.id), isNull(purchaseOrders.deletedAt), inArray(purchaseOrders.status, ["draft", "issued", "in_production"])));
    await logActivity(tx, { orgId: o.orgId, entityType: "order", entityId: o.id, type: "shipment_updated", actorId: ctx.userId, actorName: ctx.name, visibility: "internal", at, payload: { ref: o.ref, text: `Delivered ${formatDate(p.deliveredAt)}` } });
    if (o.state === "eu_port_customs" || o.state === "departed_origin") {
      await transitionOrder(o.id, "delivered", ctx, { tx, at: new Date(at.getTime() + 1000), notifyClient: false, payload: { deliveredAt: p.deliveredAt, text: `Delivered ${formatDate(p.deliveredAt)} — please confirm in the app` } });
      await tx.update(orders).set({ deliveredAt }).where(eq(orders.id, o.id));
      await notifyClients(tx, o, "client_delivery_confirm", `Delivered — please confirm ${o.ref}`, { deliveredAt: p.deliveredAt }, "delivered", at);
    }
    return { orderRef: o.ref };
  });
}

/** Upload B/L or packing list (internal) and link it to the shipment; publish separately from 07 Documents. */
export async function uploadShipmentDocument(ctx: Ctx, orderId: string, kind: "bill_of_lading" | "packing_list", file: { filename: string; mime: string; data: Buffer }, publish: boolean) {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const db = await getDb();
  return db.transaction(async (tx) => {
    const o = await lockOrder(tx, orderId);
    const at = now();
    const up = await uploadDocument(ctx, { entityType: "order", entityId: o.id, orgId: o.orgId, kind, ...file }, tx);
    await upsertShipment(tx, o, kind === "bill_of_lading" ? { blDocumentId: up.documentId } : { packingListDocumentId: up.documentId }, ctx, at);
    const pub: PublishResult | null = publish ? await publishDocument(ctx, up.documentId, { tx }) : null;
    return { orderRef: o.ref, documentId: up.documentId, pub };
  }).then((r) => { if (r.pub) throwIfBlocked(r.pub); return { orderRef: r.orderRef, documentId: r.documentId }; });
}

/** delivered → completed by an agent ("Close"); supplier_performance rolls up. */
export async function closeOrder(ctx: Ctx, orderId: string) {
  return changeOrderState(ctx, orderId, "completed", {});
}

/* ═══════════════════════════ documents on an order ═══════════════════════════ */

/** Upload to the order (internal). */
export async function uploadOrderDocument(ctx: Ctx, orderId: string, kind: DocumentKind, file: { filename: string; mime: string; data: Buffer }) {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const db = await getDb();
  const [o] = await db.select({ id: orders.id, orgId: orders.orgId, ref: orders.ref }).from(orders).where(and(eq(orders.id, orderId), isNull(orders.deletedAt))).limit(1);
  if (!o) throw new NotFound("order");
  const r = await uploadDocument(ctx, { entityType: "order", entityId: o.id, orgId: o.orgId, kind, ...file });
  return { orderRef: o.ref, ...r };
}

/** Publish + the order-level side effect: a PI published on an `order_confirmed` order moves it to awaiting_deposit and queues `client_payment_due`. */
export async function publishOrderDocument(ctx: Ctx, orderId: string, documentId: string) {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const db = await getDb();
  return db.transaction(async (tx) => {
    const o = await lockOrder(tx, orderId);
    const at = now();
    const [d] = await tx.select({ kind: documents.kind, entityId: documents.entityId }).from(documents).where(eq(documents.id, documentId)).limit(1);
    if (!d) throw new NotFound("document");
    const pub = await publishDocument(ctx, documentId, { tx });
    let transitioned: State | null = null;
    if (pub.blocked) return { orderRef: o.ref, transitioned, pub };
    if (d.kind === "pi" && d.entityId === o.id && o.state === "order_confirmed") {
      // QA-04: the deposit/fee become due only now that the client has the invoice
      const dueOn = toIsoDate(addWorkingDays(at, 5));
      await tx.update(payments).set({ dueOn, updatedAt: at }).where(and(eq(payments.orderId, o.id), inArray(payments.kind, ["deposit", "fee"]), eq(payments.status, "pending"), isNull(payments.dueOn), isNull(payments.deletedAt)));
      const due = await tx.select().from(payments).where(and(eq(payments.orderId, o.id), inArray(payments.kind, ["deposit", "fee"]), eq(payments.status, "pending"), isNull(payments.deletedAt)));
      const dep = due.find((p) => p.kind === "deposit"), fee = due.find((p) => p.kind === "fee");
      await transitionOrder(o.id, "awaiting_deposit", ctx, { tx, at: new Date(at.getTime() + 1000), notifyClient: false, payload: { feed: true, text: `Invoice ${o.piNumber ?? ""} is ready — deposit${fee ? " and fee" : ""} due ${formatDate(dep?.dueOn ?? dueOn)}`.replace("Invoice  is", "Your invoice is") } });
      const subject = `Payment due — deposit ${dep ? formatMoney({ minor: dep.amountMinor, currency: dep.currency }) : "—"}${fee ? ` + fee ${formatMoney({ minor: fee.amountMinor, currency: fee.currency })}` : ""} for ${o.ref}`;
      await notifyClients(tx, o, "client_payment_due", subject, { kind: "deposit", dueOn: dep?.dueOn ?? null, amounts: due.map((p) => ({ kind: p.kind, amount: formatMoney({ minor: p.amountMinor, currency: p.currency }) })), url: `/app/orders/${o.ref}#payments` }, "deposit", at);
      transitioned = "awaiting_deposit";
    }
    if (d.kind === "qc_report" && d.entityId === o.id) await tx.update(inspections).set({ visibleToClient: true, updatedAt: at }).where(and(eq(inspections.orderId, o.id), eq(inspections.reportDocumentId, documentId)));
    return { orderRef: o.ref, transitioned, pub };
  }).then((r) => { throwIfBlocked(r.pub); return { orderRef: r.orderRef, transitioned: r.transitioned }; });
}

/* ═══════════════════════════ timeline posts ═══════════════════════════ */

export async function postOrderNote(ctx: Ctx, orderId: string, p: { body: string; visibility: Visibility }) {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const db = await getDb();
  return db.transaction(async (tx) => {
    const o = await lockOrder(tx, orderId);
    const at = now();
    const body = p.body.trim();
    if (p.visibility === "client") assertClean({ text: body }, await loadLeakSources(tx));
    const id = uuidv7();
    await tx.insert(comments).values({ id, orgId: o.orgId, entityType: "order", entityId: o.id, authorId: ctx.userId, authorName: ctx.name, body, kind: p.visibility === "client" ? "update" : "note", visibility: p.visibility, source: "app", createdBy: ctx.userId, createdAt: at, updatedAt: at });
    await logActivity(tx, { orgId: o.orgId, entityType: "order", entityId: o.id, type: "comment_posted", actorId: ctx.userId, actorName: ctx.name, visibility: p.visibility, at, payload: { ref: o.ref, commentId: id, kind: p.visibility === "client" ? "update" : "note", text: p.visibility === "client" ? body : "Internal note" } });
    if (p.visibility === "client") {
      const name = (await tx.select({ name: requestLines.name }).from(orderLines).innerJoin(requestLines, eq(requestLines.id, orderLines.requestLineId)).where(eq(orderLines.orderId, o.id)).limit(1))[0]?.name ?? o.ref;
      await notifyClients(tx, o, "client_new_update", `Update on ${name}`, { text: body }, `${id}`, at);
    }
    return { orderRef: o.ref, commentId: id };
  });
}

export async function logWhatsApp(ctx: Ctx, orderId: string, p: { counterparty: string; body: string; occurredAt?: string }) {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const db = await getDb();
  return db.transaction(async (tx) => {
    const o = await lockOrder(tx, orderId);
    const at = now();
    const id = uuidv7();
    await tx.insert(comments).values({ id, orgId: o.orgId, entityType: "order", entityId: o.id, authorId: ctx.userId, authorName: ctx.name, body: p.body.trim(), kind: "note", visibility: "internal", source: "whatsapp_log", counterparty: p.counterparty.trim(), occurredAt: p.occurredAt ? new Date(p.occurredAt) : at, createdBy: ctx.userId, createdAt: at, updatedAt: at });
    await logActivity(tx, { orgId: o.orgId, entityType: "order", entityId: o.id, type: "whatsapp_logged", actorId: ctx.userId, actorName: ctx.name, visibility: "internal", at, payload: { ref: o.ref, commentId: id, counterparty: p.counterparty.trim() } });
    return { orderRef: o.ref, commentId: id };
  });
}

/** Answer a client question on the order (client-visible, leak-checked). */
export async function answerQuestion(ctx: Ctx, orderId: string, body: string) {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const db = await getDb();
  return db.transaction(async (tx) => {
    const o = await lockOrder(tx, orderId);
    const at = now();
    const text = body.trim();
    assertClean({ text }, await loadLeakSources(tx));
    const id = uuidv7();
    await tx.insert(comments).values({ id, orgId: o.orgId, entityType: "order", entityId: o.id, authorId: ctx.userId, authorName: ctx.name, body: text, kind: "answer", visibility: "client", source: "app", createdBy: ctx.userId, createdAt: at, updatedAt: at });
    await logActivity(tx, { orgId: o.orgId, entityType: "order", entityId: o.id, type: "comment_posted", actorId: ctx.userId, actorName: ctx.name, visibility: "client", at, payload: { ref: o.ref, commentId: id, kind: "answer", text } });
    if (o.exception === "needs_input") await setException({ orderId: o.id }, null, ctx, { tx, at: new Date(at.getTime() + 1000) });
    await notifyClients(tx, o, "client_new_update", `Update on ${o.ref}`, { text }, id, at);
    return { orderRef: o.ref };
  });
}

/* ═══════════════════════════ misc ═══════════════════════════ */

/** Orders of a client org (for lists elsewhere), cheap. */
export async function ordersOfOrg(db: DbOrTx, orgId: string) {
  return db.select({ id: orders.id, ref: orders.ref, state: orders.state }).from(orders).where(and(eq(orders.orgId, orgId), isNull(orders.deletedAt))).orderBy(desc(orders.createdAt));
}

