/**
 * Sourcing board (SPEC F-17) + the ops line workspace read model (F-15…F-20).
 * Ops-only: reads the supplier schema freely; nothing here may be imported by client code paths (lint boundary).
 */
import { ZodError } from "zod";
import { and, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { getDb, type DbOrTx, type Tx } from "@/db";
import {
  requestLines, requests, organizations, products, productSpecs, productImages, offers, offerOptions, samples, orders, orderLines,
  documents, files, comments, activityEvents, pricingRules, fxRates, rfqs, payments, factoryRanges,
} from "@/db/schema/app";
import { suppliers, supplierContacts, supplierParticipations, quotes, quotePriceBreaks, purchaseOrders } from "@/db/schema/supplier";
import type {
  LineState, LineException, Milestone, ParticipationStatus, SupplierTypeVerdict, SupplierGrade, ContactChannel, OfferStatus, SampleStatus,
  SamplePaidBy, PricingDisplay, DocumentKind, Visibility, CommentKind, CommentSource, ActivityType, ImageKind, PaymentStatus,
} from "@/db/enums";
import type { CostModel, PriceBreak } from "@/db/types";
import { type Ctx, isOps, Forbidden, NotFound } from "@/server/shared/authorize";
import { logActivity } from "@/server/shared/activity";
import { transition } from "@/server/shared/transition";
import { compare, normaliseQuote, type CompareResult, type FxLookup, type ParticipationInput, type QuoteFlag } from "@/server/shared/compare";
import { loadLineContexts, type LineContext } from "@/server/shared/line-context";
import { TRANSITIONS, type State } from "@/server/shared/state-machine";
import { nextRef } from "@/server/shared/ids";
import { now } from "@/server/shared/clock";
import { daysBetween } from "@/server/shared/dates";
import { storeDocument } from "@/server/shared/files";
import { normaliseLoadingPort, LOADING_PORTS } from "@/server/shared/leak-check";
import { collapseOpsFeed } from "@/server/shared/timeline";
import { lineThumbs, OPS_MEDIA, type Thumb } from "@/server/shared/media";

/* ───────────────────────── types ───────────────────────── */

export type OpsQuoteBreak = { minQty: number; unitPriceMinorE2: number };
export type OpsQuote = {
  id: string; version: number; currency: string; unit: string; packQty: number | null; incoterm: string | null; incotermUncertain: boolean; port: string | null;
  moq: number | null; leadDays: number | null; leadDaysMax: number | null; validUntil: string | null; paymentTerms: string | null; deviations: string | null;
  unitWeightG: number | null; carton: string | null; notes: string | null; receivedAt: string; normalisedUsdMinorE2: number | null; fxRate: number | null; fxDate: string | null;
  flags: string[]; breaks: OpsQuoteBreak[]; sourceDocument: { id: string; filename: string; href: string } | null;
};
export type OpsContact = { id: string; name: string | null; channel: ContactChannel; handle: string | null; phone: string | null; isPrimary: boolean };
export type OpsParticipation = {
  id: string; status: ParticipationStatus; reason: string | null; notes: string | null; firstContactAt: string | null; lastContactAt: string | null;
  daysSinceContact: number | null; stale: boolean;
  supplier: { id: string; ref: string; legalName: string; cnName: string | null; typeVerdict: SupplierTypeVerdict; grade: SupplierGrade | null; city: string | null; factoryLabel: string | null; disclosed: boolean };
  contact: OpsContact | null;
  quotes: OpsQuote[];
  latestQuote: OpsQuote | null;
  /** compare() output for the latest quote */
  usdMinorE2: number | null; flags: QuoteFlag[]; clean: boolean; isBestClean: boolean;
  isSelected: boolean; isBackup: boolean;
  /** QA-06: the quote's port if it is a real loading port, else the supplier's first loading port — never an inland city */
  loadingPort: string | null;
};
export type OpsCompareStrip = {
  bestClean: { usdMinorE2: number; label: string } | null;
  lowestQuoted: { usdMinorE2: number; label: string; excluded: string[] } | null;
  spread: number | null; quotesCount: number; contactedCount: number; staleCount: number;
};
export type OpsOfferOption = {
  id: string; label: "A" | "B" | "C"; participationId: string | null; supplierName: string | null; unit: string; moq: number | null; leadDays: number | null;
  priceBreaks: PriceBreak[]; feeMinor: number; factoryPriceMinorE2: number | null; deviationsPlain: string | null; sampleCostMinor: number | null;
  samplePaidBy: SamplePaidBy | null; sampleRequired: boolean; paymentTermsClient: string | null; internalNote: string | null;
};
export type OpsOffer = {
  id: string; ref: string; version: number; status: OfferStatus; pricingDisplay: PricingDisplay; currency: string; incoterm: string | null; port: string | null;
  noteToClient: string | null; validUntil: string | null; sentAt: string | null; decidedAt: string | null; acceptedOptionLabel: "A" | "B" | "C" | null;
  declineReason: string | null; changesText: string | null; options: OpsOfferOption[];
};
export type OpsSample = {
  id: string; ref: string; status: SampleStatus; costMinor: number | null; currency: string; paidBy: SamplePaidBy | null; courier: string | null; tracking: string | null;
  orderedAt: string | null; shippedAt: string | null; receivedAt: string | null; decidedAt: string | null; rejectReason: string | null; deviationsVsSpec: string | null;
  participationId: string | null; supplierName: string | null; photos: OpsDocument[]; paymentStatus: PaymentStatus | null;
};
export type OpsDocument = { id: string; filename: string; kind: DocumentKind; visibility: Visibility; bytes: number; mime: string; uploadedAt: string; uploadedByName: string | null; href: string; isImage: boolean };
export type OpsSpecVersion = { id: string; version: number; fields: Record<string, string | number | boolean>; frozenAt: string | null; frozenByName: string | null };
export type OpsProductImage = { id: string; kind: ImageKind; href: string; createdAt: string };
export type OpsFeedItem = {
  id: string; source: "event" | "comment"; at: string; visibility: Visibility; actorName: string | null;
  type: ActivityType | null; commentKind: CommentKind | null; commentSource: CommentSource | null; counterparty: string | null;
  title: string; body: string | null; attachments: { id: string; name: string; href: string }[]; isStateChange: boolean; isActionMilestone: boolean; commentId: string | null;
};
export type OpsPreviousOrder = { orderRef: string; orgName: string; qty: number; unit: string; unitPriceMinorE2: number; feeMinor: number; currency: string; supplierName: string | null; deliveredAt: string | null; confirmedAt: string | null; state: LineState };

export type OpsLine = {
  id: string; ref: string; lineNo: number; name: string; image: Thumb | null; qty: number | null; unit: string; clientSku: string | null; links: { url: string; domain: string | null; notDurable: boolean }[];
  customisation: string | null; materials: string | null; volume12m: number | null; reorderInterval: string | null;
  state: LineState; milestone: Milestone; exception: LineException | null; exceptionReason: string | null; stale: boolean; lastStateChangeAt: string; createdAt: string;
  waiting: LineContext["waiting"]; allowedTransitions: readonly State[];
  agent: { id: string; name: string } | null; isRepeat: boolean; artworkRequired: boolean; sampleRequired: boolean;
  request: { id: string; ref: string; clientRef: string | null; note: string | null; targetDelivery: string | null; destination: string | null; incotermWanted: string | null; submittedAt: string | null };
  org: { id: string; name: string; pricingDisplay: PricingDisplay; defaultIncoterm: string; commercialMode: string };
  product: { id: string; ref: string; name: string; category: string | null; hsCode: string | null; unit: string; description: string | null; visibility: string; referencePriceMinorE2: number | null; referenceMoq: number | null; images: OpsProductImage[] } | null;
  specVersion: number | null; specs: OpsSpecVersion[]; draftSpec: OpsSpecVersion | null;
  referenceImages: OpsDocument[]; documents: OpsDocument[];
  costModel: CostModel | null; upliftPct: number | null; targetPriceMinorE2: number | null; targetConfirmed: { byName: string | null; at: string } | null;
  pricingRule: { category: string; upliftPct: number; marginPct: number; feePct: number; rounding: number };
  participations: OpsParticipation[]; compare: OpsCompareStrip; selectedParticipationId: string | null; backupParticipationId: string | null;
  rfqs: { id: string; version: number; sentAt: string | null; recipientsCount: number }[];
  offers: OpsOffer[]; samples: OpsSample[]; order: { id: string; ref: string; state: LineState } | null;
  feed: OpsFeedItem[]; previousOrders: OpsPreviousOrder[]; openQuestion: { id: string; body: string; at: string } | null;
  /** QA-06: offer builder defaults — port is a real loading port (never the factory's inland city) or null */
  offerDefaults: { port: string | null; ports: readonly string[] };
  /** QA-07/QA-16d: why "Send offer" is disabled right now (null = sendable) */
  sendOfferBlockedReason: string | null;
};

/** QA-07: human reason the offer cannot be sent yet (the builder shows it next to the disabled button). */
export function sendOfferBlockedReason(p: { state: string; exception: string | null; hasQuotes: boolean; hasSentOffer: boolean; hasOrder: boolean }): string | null {
  if (p.hasOrder) return "This line is already on an order.";
  if (p.exception === "cancelled") return "The line is cancelled.";
  if (p.exception === "on_hold") return "The line is on hold — take it off hold first.";
  if (p.hasSentOffer) return "An offer is already with the client — wait for their answer (or their change request) before sending a new version.";
  if (["draft", "submitted", "in_review"].includes(p.state)) return "Freeze the spec first (Spec tab).";
  if (["sampling", "offer_accepted"].includes(p.state)) return "The client already accepted an offer.";
  if (!p.hasQuotes) return "Log at least one supplier quote on the Sourcing tab first.";
  return null;
}

/* ───────────────────────── helpers ───────────────────────── */

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
export const fileHref = (key: string, filename?: string) => `/api/files/${key}${filename ? `?filename=${encodeURIComponent(filename)}` : ""}`;

/** FX lookup from `fx_rates`: units of `currency` per 1 USD, latest rate dated ≤ `at`. */
export async function loadFx(db: DbOrTx): Promise<FxLookup & { rateFor: (currency: string, at?: Date | string) => { rate: number; date: string } | null }> {
  const rows = await db.select().from(fxRates).where(eq(fxRates.base, "USD")).orderBy(desc(fxRates.date));
  const rateFor = (currency: string, at?: Date | string) => {
    if (currency === "USD") return { rate: 1, date: "" };
    const day = at ? (typeof at === "string" ? at.slice(0, 10) : at.toISOString().slice(0, 10)) : now().toISOString().slice(0, 10);
    const r = rows.find((x) => x.quote === currency && x.date <= day) ?? rows.find((x) => x.quote === currency);
    return r ? { rate: r.rate, date: r.date } : null;
  };
  const fx = ((currency: string, at?: Date | string) => rateFor(currency, at)?.rate ?? null) as FxLookup & { rateFor: typeof rateFor };
  fx.rateFor = rateFor;
  return fx;
}

export async function pricingRuleFor(db: DbOrTx, category: string | null | undefined) {
  const rows = await db.select().from(pricingRules).where(and(isNull(pricingRules.deletedAt), inArray(pricingRules.category, [category ?? "default", "default"])));
  const r = rows.find((x) => x.category === category) ?? rows.find((x) => x.category === "default");
  return { category: r?.category ?? "default", upliftPct: r?.upliftPct ?? 20, marginPct: r?.marginPct ?? 15, feePct: r?.feePct ?? 10, rounding: r?.rounding ?? 2 };
}

async function userNameMap(db: DbOrTx, ids: (string | null | undefined)[]) {
  const { userNames } = await import("@/server/shared/users");
  return userNames(db, ids.filter((x): x is string => !!x));
}

async function lineByRef(db: DbOrTx, ref: string) {
  const [row] = await db.select().from(requestLines).where(and(eq(requestLines.lineRef, ref), isNull(requestLines.deletedAt))).limit(1);
  if (!row) throw new NotFound("line");
  return row;
}
export async function lineById(db: DbOrTx, id: string) {
  const [row] = await db.select().from(requestLines).where(and(eq(requestLines.id, id), isNull(requestLines.deletedAt))).limit(1);
  if (!row) throw new NotFound("line");
  return row;
}

/** Loads participations + supplier + contact + quotes for a line, in board order. */
export async function loadParticipations(db: DbOrTx, lineId: string, line: { qty: number | null; unit: string; selectedParticipationId: string | null; backupParticipationId: string | null; orgId: string }, fx: Awaited<ReturnType<typeof loadFx>>, at = now()) {
  const parts = await db
    .select({ p: supplierParticipations, s: suppliers })
    .from(supplierParticipations)
    .innerJoin(suppliers, eq(suppliers.id, supplierParticipations.supplierId))
    .where(and(eq(supplierParticipations.requestLineId, lineId), isNull(supplierParticipations.deletedAt)))
    .orderBy(supplierParticipations.createdAt);
  const pids = parts.map((r) => r.p.id);
  const supplierIds = [...new Set(parts.map((r) => r.s.id))];
  const [qRows, contactRows, rangeRows] = await Promise.all([
    pids.length ? db.select().from(quotes).where(inArray(quotes.participationId, pids)).orderBy(desc(quotes.version)) : [],
    supplierIds.length ? db.select().from(supplierContacts).where(and(inArray(supplierContacts.supplierId, supplierIds), isNull(supplierContacts.deletedAt))) : [],
    supplierIds.length ? db.select({ supplierId: factoryRanges.supplierId, label: factoryRanges.label }).from(factoryRanges).where(and(eq(factoryRanges.orgId, line.orgId), inArray(factoryRanges.supplierId, supplierIds as never), isNull(factoryRanges.deletedAt))) : [],
  ]);
  const qids = qRows.map((q) => q.id);
  const [breakRows, docRows] = await Promise.all([
    qids.length ? db.select().from(quotePriceBreaks).where(inArray(quotePriceBreaks.quoteId, qids)) : [],
    qRows.some((q) => q.sourceDocumentId)
      ? db.select({ d: documents, key: files.storageKey }).from(documents).innerJoin(files, eq(files.id, documents.fileId)).where(inArray(documents.id, qRows.map((q) => q.sourceDocumentId).filter((x): x is string => !!x)))
      : [],
  ]);
  const quotesByPart = new Map<string, OpsQuote[]>();
  for (const q of qRows) {
    const doc = docRows.find((d) => d.d.id === q.sourceDocumentId);
    const oq: OpsQuote = {
      id: q.id, version: q.version, currency: q.currency, unit: q.unit, packQty: q.packQty, incoterm: q.incoterm, incotermUncertain: q.incotermUncertain, port: q.port, moq: q.moq,
      leadDays: q.leadDays, leadDaysMax: q.leadDaysMax, validUntil: q.validUntil, paymentTerms: q.paymentTerms, deviations: q.deviations, unitWeightG: q.unitWeightG, carton: q.carton, notes: q.notes,
      receivedAt: q.receivedAt.toISOString(), normalisedUsdMinorE2: q.normalisedUsdMinorE2, fxRate: q.fxRate, fxDate: q.fxDate, flags: q.flags,
      breaks: breakRows.filter((b) => b.quoteId === q.id).map((b) => ({ minQty: b.minQty, unitPriceMinorE2: b.unitPriceMinorE2 })).sort((a, b) => a.minQty - b.minQty),
      sourceDocument: doc ? { id: doc.d.id, filename: doc.d.filename, href: fileHref(doc.key, doc.d.filename) } : null,
    };
    quotesByPart.set(q.participationId, [...(quotesByPart.get(q.participationId) ?? []), oq]);
  }
  const inputs: ParticipationInput[] = parts.map(({ p, s }) => {
    const latest = quotesByPart.get(p.id)?.[0] ?? null;
    return {
      id: p.id, label: s.legalName, status: p.status, verdict: s.typeVerdict, lastContactAt: p.lastContactAt,
      quote: latest ? { currency: latest.currency, unit: latest.unit, packQty: latest.packQty, incoterm: latest.incoterm, incotermUncertain: latest.incotermUncertain, validUntil: latest.validUntil, deviations: latest.deviations, receivedAt: latest.receivedAt, breaks: latest.breaks } : null,
    };
  });
  const cmp: CompareResult = compare({ qty: line.qty ?? 0, unit: line.unit }, inputs, fx, at);
  const rows: OpsParticipation[] = parts.map(({ p, s }) => {
    const c = cmp.quotes.find((q) => q.participationId === p.id) ?? null;
    const qs = quotesByPart.get(p.id) ?? [];
    const contact = (p.contactId ? contactRows.find((c) => c.id === p.contactId) : contactRows.find((c) => c.supplierId === s.id && c.isPrimary) ?? contactRows.find((c) => c.supplierId === s.id)) ?? null;
    const range = rangeRows.find((r) => r.supplierId === s.id);
    const days = p.lastContactAt ? daysBetween(p.lastContactAt, at) : null;
    return {
      id: p.id, status: p.status, reason: p.reason, notes: p.notes, firstContactAt: iso(p.firstContactAt), lastContactAt: iso(p.lastContactAt), daysSinceContact: days,
      stale: (p.status === "contacted" || p.status === "negotiating") && days !== null && days > 7,
      supplier: { id: s.id, ref: s.ref, legalName: s.legalName, cnName: s.cnName, typeVerdict: s.typeVerdict, grade: s.grade, city: s.city, factoryLabel: range?.label ?? null, disclosed: s.disclosedToOrgIds.includes(line.orgId) },
      contact: contact ? { id: contact.id, name: contact.name, channel: contact.channel, handle: contact.handle, phone: contact.phone, isPrimary: contact.isPrimary } : null,
      quotes: qs, latestQuote: qs[0] ?? null,
      usdMinorE2: c?.usdMinorE2 ?? null, flags: c?.flags ?? [], clean: c?.clean ?? false, isBestClean: !!cmp.bestClean && cmp.bestClean.participationId === p.id,
      isSelected: line.selectedParticipationId === p.id, isBackup: line.backupParticipationId === p.id,
      loadingPort: normaliseLoadingPort(qs[0]?.port) ?? (s.ports ?? []).map((x) => normaliseLoadingPort(x)).find((x) => !!x) ?? null,
    };
  });
  const order: Record<ParticipationStatus, number> = { selected: 0, backup: 1, negotiating: 2, shortlisted: 3, quoted: 4, contacted: 5, dropped: 6, cannot_make: 7 };
  rows.sort((a, b) => order[a.status] - order[b.status] || (a.usdMinorE2 ?? Infinity) - (b.usdMinorE2 ?? Infinity));
  const strip: OpsCompareStrip = {
    bestClean: cmp.bestClean && cmp.bestClean.usdMinorE2 !== null ? { usdMinorE2: cmp.bestClean.usdMinorE2, label: cmp.bestClean.label } : null,
    lowestQuoted: cmp.lowestQuoted && cmp.lowestQuoted.usdMinorE2 !== null ? { usdMinorE2: cmp.lowestQuoted.usdMinorE2, label: cmp.lowestQuoted.label, excluded: cmp.lowestQuoted.clean ? [] : excludedReasons(cmp.lowestQuoted.flags, rows.find((r) => r.id === cmp.lowestQuoted!.participationId)) } : null,
    spread: cmp.spread, quotesCount: cmp.quotesCount, contactedCount: cmp.contactedCount, staleCount: cmp.staleCount,
  };
  return { rows, strip };
}

/** "excluded: dropped, expired" (AC-BOARD-02) — status first, then the disqualifying flags in SPEC B.4 order. */
function excludedReasons(flags: QuoteFlag[], row?: OpsParticipation): string[] {
  const out: string[] = [];
  if (flags.includes("excluded_status")) out.push(row?.status ?? "dropped");
  if (flags.includes("expired")) out.push("expired");
  if (flags.includes("incoterm_uncertain")) out.push("incoterm uncertain");
  if (flags.includes("unit_mismatch")) out.push("unit mismatch");
  if (flags.includes("currency_unknown")) out.push("unknown currency");
  if (flags.includes("supplier_unchecked")) out.push("unchecked");
  if (flags.includes("supplier_trading")) out.push("trading company");
  return out;
}

async function loadDocs(db: DbOrTx, entities: { entityType: (typeof documents.$inferSelect)["entityType"]; entityId: string }[]): Promise<OpsDocument[]> {
  if (!entities.length) return [];
  const conds = entities.map((e) => and(eq(documents.entityType, e.entityType), eq(documents.entityId, e.entityId)));
  const rows = await db.select({ d: documents, f: files }).from(documents).innerJoin(files, eq(files.id, documents.fileId)).where(and(isNull(documents.deletedAt), or(...conds))).orderBy(desc(documents.createdAt));
  const names = await userNameMap(db, rows.map((r) => r.d.uploadedBy));
  return rows.map(({ d, f }) => ({ id: d.id, filename: d.filename, kind: d.kind, visibility: d.visibility, bytes: f.bytes, mime: f.mime, uploadedAt: d.createdAt.toISOString(), uploadedByName: d.uploadedBy ? names[d.uploadedBy] ?? null : null, href: fileHref(f.storageKey, d.filename), isImage: f.mime.startsWith("image/") }));
}

/* ───────────────────────── the workspace read model ───────────────────────── */

export async function getOpsLine(ctx: Ctx, ref: string): Promise<OpsLine> {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const db = await getDb();
  const at = now();
  const line = await lineByRef(db, ref);
  const [req] = await db.select().from(requests).where(eq(requests.id, line.requestId)).limit(1);
  const [org] = await db.select().from(organizations).where(eq(organizations.id, line.orgId)).limit(1);
  const [lc] = await loadLineContexts(db, { lineIds: [line.id], includeCancelled: true, includeDrafts: true }, at);
  const [fx, thumbs] = await Promise.all([loadFx(db), lineThumbs(db, [line.id], OPS_MEDIA)]);
  const product = line.productId ? (await db.select().from(products).where(eq(products.id, line.productId)).limit(1))[0] ?? null : null;
  const [specRows, imageRows, rule, { rows: parts, strip }, rfqRows, offerRows, sampleRows, eventRows, commentRows] = await Promise.all([
    product ? db.select().from(productSpecs).where(eq(productSpecs.productId, product.id)).orderBy(desc(productSpecs.version)) : [],
    product ? db.select({ i: productImages, key: files.storageKey }).from(productImages).innerJoin(files, eq(files.id, productImages.fileId)).where(eq(productImages.productId, product.id)).orderBy(desc(productImages.createdAt)) : [],
    pricingRuleFor(db, product?.category),
    loadParticipations(db, line.id, { qty: line.qtyFirst, unit: line.unit, selectedParticipationId: line.selectedParticipationId, backupParticipationId: line.backupParticipationId, orgId: line.orgId }, fx, at),
    db.select().from(rfqs).where(and(eq(rfqs.requestLineId, line.id), isNull(rfqs.deletedAt))).orderBy(desc(rfqs.version)),
    db.select().from(offers).where(and(eq(offers.requestLineId, line.id), isNull(offers.deletedAt))).orderBy(desc(offers.version)),
    db.select().from(samples).where(and(eq(samples.requestLineId, line.id), isNull(samples.deletedAt))).orderBy(desc(samples.createdAt)),
    db.select().from(activityEvents).where(or(and(eq(activityEvents.entityType, "request_line"), eq(activityEvents.entityId, line.id)), lc?.order ? and(eq(activityEvents.entityType, "order"), eq(activityEvents.entityId, lc.order.id)) : sql`false`)).orderBy(desc(activityEvents.createdAt)).limit(400),
    db.select().from(comments).where(and(eq(comments.entityType, "request_line"), eq(comments.entityId, line.id), isNull(comments.deletedAt))).orderBy(desc(comments.createdAt)),
  ]);
  const offerIds = offerRows.map((o) => o.id);
  const optRows = offerIds.length ? await db.select().from(offerOptions).where(inArray(offerOptions.offerId, offerIds)).orderBy(offerOptions.label) : [];
  const partName = new Map(parts.map((p) => [p.id, p.supplier.legalName]));
  const sampleIds = sampleRows.map((s) => s.id);
  const [lineDocs, sampleDocs, orderDocs] = await Promise.all([
    loadDocs(db, [{ entityType: "request_line", entityId: line.id }]),
    loadDocs(db, sampleIds.map((id) => ({ entityType: "sample" as const, entityId: id }))),
    lc?.order ? loadDocs(db, [{ entityType: "order", entityId: lc.order.id }]) : Promise.resolve([] as OpsDocument[]),
  ]);
  const samplePays = sampleIds.length ? await db.select().from(payments).where(and(eq(payments.requestLineId, line.id), eq(payments.kind, "sample"), isNull(payments.deletedAt))) : [];
  const names = await userNameMap(db, [line.assignedAgentId, line.targetConfirmedBy, ...specRows.map((s) => s.frozenBy)]);
  const attachmentDocs = new Map([...lineDocs, ...sampleDocs, ...orderDocs].map((d) => [d.id, d]));

  // feed: events + comments merged newest first
  const feed: OpsFeedItem[] = [
    ...eventRows.map((e): OpsFeedItem => {
      const p = e.payload as Record<string, unknown>;
      return {
        id: e.id, source: "event", at: e.createdAt.toISOString(), visibility: e.visibility, actorName: e.actorName, type: e.type, commentKind: null, commentSource: null, counterparty: null,
        title: opsEventText(e.type, p), body: null, attachments: [], isStateChange: e.type === "state_changed" || e.type === "state_overridden",
        isActionMilestone: typeof p.milestone === "string" && ["price_ready", "sample", "order_confirmed", "quality_check", "delivered"].includes(p.milestone as string) && p.milestoneChanged === true, commentId: null,
      };
    }),
    ...commentRows.filter((c) => c.kind !== "note" || c.source !== "app" || true).map((c): OpsFeedItem => ({
      id: c.id, source: "comment", at: (c.occurredAt ?? c.createdAt).toISOString(), visibility: c.visibility, actorName: c.authorName, type: null, commentKind: c.kind, commentSource: c.source, counterparty: c.counterparty,
      title: c.source === "whatsapp_log" ? "WhatsApp log" : c.kind === "question" ? "Client question" : c.kind === "answer" ? "Answer to client" : c.kind === "note" ? "Internal note" : c.kind === "change_request" ? "Change requested" : c.kind === "decline_reason" ? "Offer declined" : c.kind === "reject_reason" ? "Sample rejected" : "Client update",
      body: c.body, attachments: c.attachments.map((id) => attachmentDocs.get(id)).filter((d): d is OpsDocument => !!d).map((d) => ({ id: d.id, name: d.filename, href: d.href })), isStateChange: false, isActionMilestone: false, commentId: c.id,
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  // previous orders of this product (all orgs, ops variant D-19)
  let previousOrders: OpsPreviousOrder[] = [];
  if (product) {
    const rows = await db.select({ ol: orderLines, o: orders, orgName: organizations.name }).from(orderLines).innerJoin(orders, eq(orders.id, orderLines.orderId)).innerJoin(organizations, eq(organizations.id, orders.orgId))
      .where(and(eq(orderLines.productId, product.id), isNull(orders.deletedAt), sql`${orders.id} <> ${lc?.order?.id ?? "00000000-0000-0000-0000-000000000000"}`)).orderBy(desc(orders.confirmedAt));
    const poIds = rows.map((r) => r.ol.poId).filter((x): x is NonNullable<typeof x> => !!x);
    const poRows = poIds.length ? await db.select({ id: purchaseOrders.id, name: suppliers.legalName }).from(purchaseOrders).innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId)).where(inArray(purchaseOrders.id, poIds as never)) : [];
    const partIds = rows.map((r) => r.ol.participationId).filter((x): x is NonNullable<typeof x> => !!x);
    const partRows = partIds.length ? await db.select({ id: supplierParticipations.id, name: suppliers.legalName }).from(supplierParticipations).innerJoin(suppliers, eq(suppliers.id, supplierParticipations.supplierId)).where(inArray(supplierParticipations.id, partIds as never)) : [];
    previousOrders = rows.map(({ ol, o, orgName }) => ({
      orderRef: o.ref, orgName, qty: ol.qty, unit: ol.unit, unitPriceMinorE2: ol.unitPriceMinorE2, feeMinor: ol.feeMinor, currency: o.currency, state: o.state,
      supplierName: poRows.find((p) => p.id === ol.poId)?.name ?? partRows.find((p) => p.id === ol.participationId)?.name ?? null, deliveredAt: iso(o.deliveredAt), confirmedAt: iso(o.confirmedAt),
    }));
  }

  const openQ = commentRows.find((c) => c.visibility === "client" && c.kind === "question");
  const specs: OpsSpecVersion[] = specRows.map((s) => ({ id: s.id, version: s.version, fields: s.fields, frozenAt: iso(s.frozenAt), frozenByName: s.frozenBy ? names[s.frozenBy] ?? null : null }));
  return {
    id: line.id, ref: line.lineRef, lineNo: line.lineNo, name: line.name, qty: line.qtyFirst, unit: line.unit, clientSku: line.clientSku,
    image: thumbs.get(line.id) ?? null,
    links: line.clientLinks.map((url) => { const m = line.linksMeta.find((x) => x.url === url); return { url, domain: m?.domain ?? safeHost(url), notDurable: !!m?.not_durable }; }),
    customisation: line.customisation, materials: line.materials, volume12m: line.volume12m, reorderInterval: line.reorderInterval,
    state: lc?.state ?? line.state, milestone: lc?.milestone ?? line.milestone, exception: lc?.exception ?? line.exception, exceptionReason: lc?.exceptionReason ?? line.exceptionReason, stale: lc?.stale ?? false,
    lastStateChangeAt: (lc?.lastStateChangeAt ?? line.lastStateChangeAt).toISOString(), createdAt: line.createdAt.toISOString(), waiting: lc?.waiting ?? { party: "agency", reason: line.state },
    allowedTransitions: lc?.order ? [] : TRANSITIONS[line.state as State],
    agent: line.assignedAgentId ? { id: line.assignedAgentId, name: names[line.assignedAgentId] ?? "—" } : null, isRepeat: line.isRepeat, artworkRequired: line.artworkRequired, sampleRequired: line.sampleRequired,
    request: { id: req.id, ref: req.ref, clientRef: req.clientRef, note: req.note, targetDelivery: req.targetDelivery, destination: req.destination, incotermWanted: req.incotermWanted, submittedAt: iso(req.submittedAt) },
    org: { id: org.id, name: org.name, pricingDisplay: org.pricingDisplay, defaultIncoterm: org.defaultIncoterm, commercialMode: org.commercialMode },
    product: product ? { id: product.id, ref: product.ref, name: product.name, category: product.category, hsCode: product.hsCode, unit: product.unit, description: product.description, visibility: product.visibility, referencePriceMinorE2: product.referencePriceMinorE2, referenceMoq: product.referenceMoq, images: imageRows.map(({ i, key }) => ({ id: i.id, kind: i.kind, href: fileHref(key), createdAt: i.createdAt.toISOString() })) } : null,
    specVersion: line.specVersion, specs: specs.filter((s) => s.frozenAt), draftSpec: specs.find((s) => !s.frozenAt) ?? null,
    referenceImages: lineDocs.filter((d) => d.kind === "reference_image"), documents: [...lineDocs, ...sampleDocs, ...orderDocs],
    costModel: line.costModel, upliftPct: line.upliftPct, targetPriceMinorE2: line.targetPriceMinorE2, targetConfirmed: line.targetConfirmedAt ? { byName: line.targetConfirmedBy ? names[line.targetConfirmedBy] ?? null : null, at: line.targetConfirmedAt.toISOString() } : null,
    pricingRule: rule,
    participations: parts, compare: strip, selectedParticipationId: line.selectedParticipationId, backupParticipationId: line.backupParticipationId,
    rfqs: rfqRows.map((r) => ({ id: r.id, version: r.version, sentAt: iso(r.sentAt), recipientsCount: r.recipientsCount })),
    offers: offerRows.map((o) => ({
      id: o.id, ref: o.ref, version: o.version, status: o.status, pricingDisplay: o.pricingDisplay, currency: o.currency, incoterm: o.incoterm, port: o.port, noteToClient: o.noteToClient, validUntil: o.validUntil, sentAt: iso(o.sentAt), decidedAt: iso(o.decidedAt),
      acceptedOptionLabel: (optRows.find((x) => x.id === o.acceptedOptionId)?.label as "A" | "B" | "C" | undefined) ?? null, declineReason: o.declineReason, changesText: o.changesText,
      options: optRows.filter((x) => x.offerId === o.id).map((x) => ({ id: x.id, label: x.label, participationId: x.participationId, supplierName: x.participationId ? partName.get(x.participationId) ?? null : null, unit: x.unit, moq: x.moq, leadDays: x.leadDays, priceBreaks: x.priceBreaks, feeMinor: x.feeMinor, factoryPriceMinorE2: x.factoryPriceMinorE2, deviationsPlain: x.deviationsPlain, sampleCostMinor: x.sampleCostMinor, samplePaidBy: x.samplePaidBy, sampleRequired: x.sampleRequired, paymentTermsClient: x.paymentTermsClient, internalNote: x.internalNote })),
    })),
    samples: sampleRows.map((s) => ({
      id: s.id, ref: s.ref, status: s.status, costMinor: s.costMinor, currency: s.currency, paidBy: s.paidBy, courier: s.courier, tracking: s.tracking, orderedAt: iso(s.orderedAt), shippedAt: iso(s.shippedAt), receivedAt: iso(s.receivedAt), decidedAt: iso(s.decidedAt),
      rejectReason: s.rejectReason, deviationsVsSpec: s.deviationsVsSpec, participationId: s.participationId, supplierName: s.participationId ? partName.get(s.participationId) ?? null : null,
      photos: sampleDocs.filter((d) => d.kind === "sample_photo"), paymentStatus: samplePays.find((p) => p.createdAt.getTime() >= (s.orderedAt?.getTime() ?? 0) - 1)?.status ?? null,
    })),
    order: lc?.order ? { id: lc.order.id, ref: lc.order.ref, state: lc.order.state } : null,
    feed: collapseOpsFeed(feed), previousOrders, openQuestion: openQ && line.exception === "needs_input" ? { id: openQ.id, body: openQ.body, at: openQ.createdAt.toISOString() } : null,
    offerDefaults: {
      port: (parts.find((p) => p.isSelected && p.loadingPort) ?? parts.find((p) => p.latestQuote && p.loadingPort && !["dropped", "cannot_make"].includes(p.status)) ?? parts.find((p) => p.loadingPort))?.loadingPort ?? null,
      ports: LOADING_PORTS,
    },
    sendOfferBlockedReason: sendOfferBlockedReason({ state: lc?.state ?? line.state, exception: lc?.exception ?? line.exception, hasQuotes: parts.some((p) => p.latestQuote), hasSentOffer: offerRows.some((o) => o.status === "sent"), hasOrder: !!lc?.order }),
  };
}

const safeHost = (url: string) => { try { return new URL(url).hostname; } catch { return null; } };

/** Ops feed text for an event (internal payloads may name suppliers — this never reaches clients). */
export function opsEventText(type: ActivityType, p: Record<string, unknown>): string {
  const s = (k: string) => (typeof p[k] === "string" || typeof p[k] === "number" ? String(p[k]) : "");
  if (typeof p.text === "string" && p.text) return p.text;
  switch (type) {
    case "state_changed": return `${label("state", s("from"))} → ${label("state", s("to"))}${p.note ? ` — ${s("note")}` : ""}`;
    case "state_overridden": return `State overridden: ${label("state", s("from"))} → ${label("state", s("to"))} (${s("reason")})`;
    case "line_assigned": return `Assigned to ${s("agentName")}`;
    case "participation_added": return `Supplier added: ${s("supplierName")}`;
    case "participation_status_changed": return `${s("supplierName")} → ${label("participation", s("status"))}${p.reason ? ` (${s("reason")})` : ""}`;
    case "quote_logged": return `Quote logged: ${s("supplierName")} ${s("currency")} ${s("price")}`;
    case "cost_model_saved": return `Cost model saved — est. ${s("est")} · target ${s("target")}`;
    case "target_confirmed": return `Target price confirmed — ${s("target")}`;
    case "rfq_sent": return `RFQ sent to ${s("recipients")} suppliers`;
    case "spec_frozen": return `Spec frozen v${s("version")}`;
    case "offer_sent": return `Offer v${s("version")} sent`;
    case "offer_decided": return `Offer ${s("decision").replace(/_/g, " ")}${p.option ? ` (Option ${s("option")})` : ""}`;
    case "sample_created": return `Sample created ${s("sampleRef")}`;
    case "sample_status_changed": return `Sample ${label("sampleStatus", s("status")).toLowerCase()}`;
    case "sample_decided": return `Sample ${s("decision")}`;
    case "exception_set": return `Flag set: ${label("exception", s("exception"))}${p.reason ? ` — ${s("reason")}` : ""}`;
    case "exception_cleared": return "Flag cleared";
    case "comment_posted": return "Comment posted";
    case "whatsapp_logged": return `WhatsApp logged${p.counterparty ? ` ↔ ${s("counterparty")}` : ""}`;
    case "document_uploaded": return `Document added: ${s("filename")}`;
    case "document_published": return `Document published: ${label("documentKind", s("kind"))}`;
    case "leak_check_blocked": return `Leak check blocked ${s("where")}`;
    case "po_updated": return `PO updated${p.poRef ? ` ${s("poRef")}` : ""}${p.note ? ` — ${s("note")}` : ""}`;
    default: return label("activityType", type);
  }
}

/* ───────────────────────── mutations ───────────────────────── */

const bump = (at: Date, dontBump?: boolean) => (dontBump ? {} : { lastContactAt: at });

/** + Supplier search: legal name / CN name / contact name or handle (AC-BOARD-08). */
export async function searchSuppliers(ctx: Ctx, q: string, lineId?: string) {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const db = await getDb();
  const term = `%${q.trim()}%`;
  if (!q.trim()) return [];
  const byContact = await db.select({ supplierId: supplierContacts.supplierId }).from(supplierContacts).where(and(isNull(supplierContacts.deletedAt), or(ilike(supplierContacts.name, term), ilike(supplierContacts.handle, term))));
  const rows = await db.select().from(suppliers).where(and(isNull(suppliers.deletedAt), or(ilike(suppliers.legalName, term), ilike(suppliers.cnName, term), ilike(suppliers.ref, term), byContact.length ? inArray(suppliers.id, byContact.map((c) => c.supplierId)) : sql`false`))).orderBy(suppliers.legalName).limit(20);
  const existing = lineId ? new Set((await db.select({ supplierId: supplierParticipations.supplierId }).from(supplierParticipations).where(and(eq(supplierParticipations.requestLineId, lineId), isNull(supplierParticipations.deletedAt)))).map((r) => r.supplierId)) : new Set<string>();
  const contacts = rows.length ? await db.select().from(supplierContacts).where(and(inArray(supplierContacts.supplierId, rows.map((r) => r.id)), isNull(supplierContacts.deletedAt))) : [];
  return rows.map((s) => ({ id: s.id, ref: s.ref, legalName: s.legalName, cnName: s.cnName, typeVerdict: s.typeVerdict, grade: s.grade, city: s.city, onLine: existing.has(s.id), contacts: contacts.filter((c) => c.supplierId === s.id).map((c) => ({ id: c.id, name: c.name, channel: c.channel, handle: c.handle })) }));
}

export type AddParticipationInput = { lineId: string; supplierId?: string; contactId?: string | null; status?: ParticipationStatus; notes?: string | null; create?: { legalName: string; cnName?: string | null; city?: string | null; contactName?: string | null; channel: ContactChannel; handle?: string | null; phone?: string | null } };

/** + Supplier: pick an existing supplier or create one inline with its first contact (F-17). */
export async function addParticipation(ctx: Ctx, input: AddParticipationInput): Promise<{ participationId: string; supplierRef: string; lineRef: string }> {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const db = await getDb();
  const at = now();
  return db.transaction(async (tx) => {
    const line = await lineById(tx, input.lineId);
    let supplierId = input.supplierId ?? null;
    let contactId = input.contactId ?? null;
    let supplierRef = "";
    if (!supplierId && input.create) {
      const c = input.create;
      const norm = c.legalName.toLowerCase().replace(/[^a-z0-9一-鿿]+/g, " ").trim();
      const [dup] = await tx.select({ id: suppliers.id, ref: suppliers.ref }).from(suppliers).where(and(eq(suppliers.normalisedName, norm), isNull(suppliers.deletedAt))).limit(1);
      if (dup) { supplierId = dup.id; supplierRef = dup.ref; }
      else {
        supplierRef = await nextRef(tx as never, "SUP");
        supplierId = uuidv7();
        await tx.insert(suppliers).values({ id: supplierId, ref: supplierRef, legalName: c.legalName, normalisedName: norm, cnName: c.cnName ?? null, city: c.city ?? null, typeVerdict: "unchecked", createdBy: ctx.userId, createdAt: at, updatedAt: at });
      }
      if (c.contactName?.trim() || c.handle?.trim() || c.phone?.trim()) { // QA-42: no empty "(no name)" contact
        contactId = uuidv7();
        await tx.insert(supplierContacts).values({ id: contactId, supplierId, name: c.contactName ?? null, channel: c.channel, handle: c.handle ?? null, phone: c.phone ?? null, isPrimary: !dup, createdAt: at });
      }
      const { invalidateLeakSources } = await import("@/server/shared/leak-check");
      invalidateLeakSources();
    }
    if (!supplierId) throw new Error("supplier required");
    const [sup] = await tx.select({ ref: suppliers.ref, legalName: suppliers.legalName }).from(suppliers).where(eq(suppliers.id, supplierId)).limit(1);
    if (!sup) throw new NotFound("supplier");
    const [existing] = await tx.select({ id: supplierParticipations.id }).from(supplierParticipations).where(and(eq(supplierParticipations.requestLineId, line.id), eq(supplierParticipations.supplierId, supplierId), isNull(supplierParticipations.deletedAt))).limit(1);
    if (existing) return { participationId: existing.id, supplierRef: sup.ref, lineRef: line.lineRef };
    const id = uuidv7();
    await tx.insert(supplierParticipations).values({ id, requestLineId: line.id, supplierId, contactId, status: input.status ?? "contacted", notes: input.notes ?? null, firstContactAt: at, lastContactAt: at, createdBy: ctx.userId, createdAt: at, updatedAt: at });
    await logActivity(tx, { orgId: line.orgId, entityType: "request_line", entityId: line.id, type: "participation_added", actorId: ctx.userId, actorName: ctx.name, visibility: "internal", at, payload: { ref: line.lineRef, supplierRef: sup.ref, supplierName: sup.legalName, participationId: id } });
    return { participationId: id, supplierRef: sup.ref, lineRef: line.lineRef };
  });
}

export { REASON_REQUIRED } from "@/components/ops/board/pure";
/** Enum arrays re-exported for action files (which may not import @/db directly). */
export { PARTICIPATION_STATUSES, CONTACT_CHANNELS, INCOTERMS, SAMPLE_PAID_BY, LINE_STATES, PRODUCT_CATEGORIES, UNITS } from "@/db/enums";
import { REASON_REQUIRED } from "@/components/ops/board/pure";
import { label } from "@/lib/labels";

/** Status change with the SPEC F-17 side effects (selected/backup pointers, line state follow-ups). */
export async function setParticipationStatus(ctx: Ctx, input: { participationId: string; status: ParticipationStatus; reason?: string | null; dontBump?: boolean }) {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const db = await getDb();
  const at = now();
  if (REASON_REQUIRED.includes(input.status) && !(input.reason ?? "").trim()) {
    const { ZodError } = await import("zod");
    throw new ZodError([{ code: "custom", path: ["reason"], message: "Reason required", input: input.reason } as never]);
  }
  return db.transaction(async (tx) => {
    const [p] = await tx.select().from(supplierParticipations).where(eq(supplierParticipations.id, input.participationId)).for("update");
    if (!p || p.deletedAt) throw new NotFound("participation");
    const line = await lineById(tx, p.requestLineId);
    const [sup] = await tx.select({ ref: suppliers.ref, legalName: suppliers.legalName }).from(suppliers).where(eq(suppliers.id, p.supplierId)).limit(1);
    await tx.update(supplierParticipations).set({ status: input.status, reason: input.reason ?? (REASON_REQUIRED.includes(input.status) ? p.reason : null), updatedAt: at, ...bump(at, input.dontBump) }).where(eq(supplierParticipations.id, p.id));
    const patch: Partial<typeof requestLines.$inferInsert> = { updatedAt: at };
    if (input.status === "selected") {
      if (line.selectedParticipationId && line.selectedParticipationId !== p.id) {
        await tx.update(supplierParticipations).set({ status: "backup", reason: "demoted — another supplier selected", updatedAt: at }).where(eq(supplierParticipations.id, line.selectedParticipationId));
        patch.backupParticipationId = line.selectedParticipationId;
      }
      patch.selectedParticipationId = p.id as never;
      if (line.backupParticipationId === p.id) patch.backupParticipationId = null;
    } else if (input.status === "backup") {
      patch.backupParticipationId = p.id as never;
      if (line.selectedParticipationId === p.id) patch.selectedParticipationId = null;
    } else {
      if (line.selectedParticipationId === p.id) patch.selectedParticipationId = null;
      if (line.backupParticipationId === p.id) patch.backupParticipationId = null;
    }
    await tx.update(requestLines).set(patch).where(eq(requestLines.id, line.id));
    await logActivity(tx, { orgId: line.orgId, entityType: "request_line", entityId: line.id, type: "participation_status_changed", actorId: ctx.userId, actorName: ctx.name, visibility: "internal", at, payload: { ref: line.lineRef, supplierRef: sup?.ref, supplierName: sup?.legalName, participationId: p.id, from: p.status, status: input.status, reason: input.reason ?? null } });
    // line state follow-ups (SPEC 3.4); a line whose quotes were logged before "Mark RFQ sent" is caught up first (QA-07)
    let state = line.state as State;
    if ((input.status === "shortlisted" || input.status === "negotiating" || input.status === "selected") && PRE_QUOTES_STATES.includes(state)) state = await ensureQuotesIn(tx, line, ctx, at);
    if (input.status === "shortlisted" && state === "quotes_in") await transition(line.id, "shortlisted", ctx, { tx, at: new Date(at.getTime() + 5) });
    if (input.status === "negotiating" && (state === "quotes_in" || state === "shortlisted")) await transition(line.id, "negotiating", ctx, { tx, at: new Date(at.getTime() + 5) });
    return { lineRef: line.lineRef };
  });
}

/** Notes / contact edit on a participation; every save bumps last_contact_at unless `dontBump`. */
export async function updateParticipation(ctx: Ctx, input: { participationId: string; notes?: string | null; contactId?: string | null; lastContactAt?: string | null; dontBump?: boolean }) {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const db = await getDb();
  const at = now();
  return db.transaction(async (tx) => {
    const [p] = await tx.select().from(supplierParticipations).where(eq(supplierParticipations.id, input.participationId)).for("update");
    if (!p || p.deletedAt) throw new NotFound("participation");
    const line = await lineById(tx, p.requestLineId);
    await tx.update(supplierParticipations).set({
      ...(input.notes !== undefined ? { notes: input.notes } : {}), ...(input.contactId !== undefined ? { contactId: input.contactId } : {}),
      ...(input.lastContactAt ? { lastContactAt: new Date(input.lastContactAt) } : bump(at, input.dontBump)), updatedAt: at,
    }).where(eq(supplierParticipations.id, p.id));
    await logActivity(tx, { orgId: line.orgId, entityType: "request_line", entityId: line.id, type: "line_updated", actorId: ctx.userId, actorName: ctx.name, visibility: "internal", at, payload: { ref: line.lineRef, participationId: p.id, text: `Board note updated` } });
    return { lineRef: line.lineRef };
  });
}

/** "Mark RFQ sent": rfqs row, participations without status → contacted, transition → rfq_out (SPEC 3.4). */
export async function markRfqSent(ctx: Ctx, input: { lineId: string; recipientsCount?: number; file?: { data: Buffer; mime: string; filename: string } | null }) {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const db = await getDb();
  const at = now();
  return db.transaction(async (tx) => {
    const line = await lineById(tx, input.lineId);
    const parts = await tx.select().from(supplierParticipations).where(and(eq(supplierParticipations.requestLineId, line.id), isNull(supplierParticipations.deletedAt)));
    const recipients = Math.max(input.recipientsCount ?? 0, parts.length);
    if (recipients < 1) { throw new ZodError([{ code: "custom", path: ["recipientsCount"], message: "Add at least one supplier or enter a recipient count", input: recipients } as never]); }
    if (line.state === "cost_target_price" && !line.targetConfirmedAt) { throw new ZodError([{ code: "custom", path: ["_"], message: "Confirm the target price first", input: null } as never]); }
    const [prev] = await tx.select({ v: sql<number>`coalesce(max(${rfqs.version}), 0)` }).from(rfqs).where(eq(rfqs.requestLineId, line.id));
    let fileId: string | null = null;
    if (input.file) {
      const r = await storeDocument(tx, { orgId: line.orgId, userId: ctx.userId, actorName: ctx.name, data: input.file.data, mime: input.file.mime, filename: input.file.filename, entity: "request_line", entityId: line.id, kind: "rfq", visibility: "internal", at });
      fileId = r.file.id;
    }
    await tx.insert(rfqs).values({ id: uuidv7(), requestId: line.requestId, requestLineId: line.id, orgId: line.orgId, version: Number(prev?.v ?? 0) + 1, fileId, sentAt: at, recipientsCount: recipients, createdBy: ctx.userId, createdAt: at, updatedAt: at });
    for (const p of parts) if (!p.firstContactAt || !p.lastContactAt) await tx.update(supplierParticipations).set({ firstContactAt: p.firstContactAt ?? at, lastContactAt: p.lastContactAt ?? at, updatedAt: at }).where(eq(supplierParticipations.id, p.id));
    await logActivity(tx, { orgId: line.orgId, entityType: "request_line", entityId: line.id, type: "rfq_sent", actorId: ctx.userId, actorName: ctx.name, visibility: "internal", at, payload: { ref: line.lineRef, recipients } });
    if (line.state === "cost_target_price" || line.state === "spec_frozen") {
      await transition(line.id, "rfq_out", ctx, { tx, at, payload: { reached: recipients } });
      // QA-07: quotes logged before the RFQ was marked sent → straight on to quotes_in
      if (await lineHasQuotes(tx, line.id)) await transition(line.id, "quotes_in", null, { tx, at: new Date(at.getTime() + 5) });
    }
    return { lineRef: line.lineRef, recipients };
  });
}

/** States in which a logged quote means the line is behind (QA-07). */
export const PRE_QUOTES_STATES: readonly State[] = ["spec_frozen", "cost_target_price", "rfq_out"];

export async function lineHasQuotes(tx: DbOrTx, lineId: string): Promise<boolean> {
  const [q] = await tx.select({ id: quotes.id }).from(quotes).innerJoin(supplierParticipations, eq(supplierParticipations.id, quotes.participationId))
    .where(and(eq(supplierParticipations.requestLineId, lineId), isNull(supplierParticipations.deletedAt))).limit(1);
  return !!q;
}

/**
 * QA-07: a quote exists but the line is still in spec_frozen / cost_target_price / rfq_out (quotes were logged before
 * "Mark RFQ sent"). Records the RFQ if none exists (auto, internal event) and walks the legal transitions to quotes_in.
 * Returns the resulting state. No client email: all three states share the "Finding factory" milestone.
 */
export async function ensureQuotesIn(tx: Tx, line: { id: string; state: string; orgId: string; requestId: string; lineRef: string }, ctx: Ctx | null, at: Date): Promise<State> {
  let state = line.state as State;
  if (!PRE_QUOTES_STATES.includes(state)) return state;
  let t = at.getTime();
  if (state === "spec_frozen" || state === "cost_target_price") {
    const [existing] = await tx.select({ id: rfqs.id }).from(rfqs).where(and(eq(rfqs.requestLineId, line.id), isNull(rfqs.deletedAt))).limit(1);
    if (!existing) {
      const parts = await tx.select({ id: supplierParticipations.id }).from(supplierParticipations).where(and(eq(supplierParticipations.requestLineId, line.id), isNull(supplierParticipations.deletedAt)));
      await tx.insert(rfqs).values({ id: uuidv7(), requestId: line.requestId, requestLineId: line.id, orgId: line.orgId, version: 1, sentAt: at, recipientsCount: Math.max(1, parts.length), createdBy: ctx?.userId ?? null, createdAt: at, updatedAt: at });
      await logActivity(tx, { orgId: line.orgId, entityType: "request_line", entityId: line.id, type: "rfq_sent", actorId: ctx?.userId ?? null, actorName: ctx?.name ?? "System", visibility: "internal", at, payload: { ref: line.lineRef, recipients: Math.max(1, parts.length), auto: true, text: `RFQ recorded automatically (quote logged before "Mark RFQ sent")` } });
    }
    await transition(line.id, "rfq_out", ctx, { tx, at: new Date(++t) });
    state = "rfq_out";
  }
  await transition(line.id, "quotes_in", null, { tx, at: new Date(++t) });
  return "quotes_in";
}

/** Header "Change state": any transition allowed by the table; admin override with reason. */
export async function changeLineState(ctx: Ctx, input: { lineId: string; to: State; note?: string | null; override?: boolean; reason?: string | null }) {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  if (input.override && ctx.role !== "admin") throw new Forbidden("admin only");
  if (input.override && !(input.reason ?? "").trim()) throw new ZodError([{ code: "custom", path: ["reason"], message: "Give a reason for the override", input: input.reason } as never]);
  if (!input.override) {
    const cur = await lineById(await getDb(), input.lineId);
    if (!TRANSITIONS[cur.state as State]?.includes(input.to)) throw new ZodError([{ code: "custom", path: ["to"], message: `Can't move from ${cur.state.replace(/_/g, " ")} to ${input.to.replace(/_/g, " ")} — tick "Override" (admin) and give a reason`, input: input.to } as never]);
  }
  const r = await transition(input.lineId, input.to, ctx, { note: input.note ?? undefined, override: input.override && input.reason ? { reason: input.reason } : undefined, clearException: input.to === "negotiating" || input.to === "rfq_out" || input.to === "shortlisted" });
  const db = await getDb();
  const line = await lineById(db, input.lineId);
  return { lineRef: line.lineRef, ...r };
}

/** Bulk shortlist with one reason (F-17 "Shortlist"). */
export async function shortlistParticipations(ctx: Ctx, input: { participationIds: string[]; reason: string }) {
  for (const id of input.participationIds) await setParticipationStatus(ctx, { participationId: id, status: "shortlisted", reason: input.reason });
}

/** Quick normalisation preview for the Log quote sheet (client-side call through an action). */
export async function previewNormalisation(ctx: Ctx, input: { lineId: string; currency: string; unit: string; packQty?: number | null; breaks: { minQty: number; unitPriceMinorE2: number }[] }) {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const db = await getDb();
  const line = await lineById(db, input.lineId);
  const fx = await loadFx(db);
  const n = normaliseQuote({ currency: input.currency, unit: input.unit, packQty: input.packQty, breaks: input.breaks }, { qty: line.qtyFirst ?? 0, unit: line.unit }, fx);
  const rate = fx.rateFor(input.currency);
  return { usdMinorE2: n.usdMinorE2, breakMinQty: n.breakMinQty, flags: n.flags, fxRate: rate?.rate ?? null, fxDate: rate?.date ?? null };
}
