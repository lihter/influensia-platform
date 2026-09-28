/**
 * Log quote (SPEC F-17 "Fields — quote"): versioned per participation, price breaks, normalised USD with the dated FX rate,
 * cached B.4 flags, optional source file (document `quote_file`, internal). First quote on a line: rfq_out → quotes_in.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { getDb } from "@/db";
import { requestLines } from "@/db/schema/app";
import { suppliers, supplierParticipations, quotes, quotePriceBreaks } from "@/db/schema/supplier";
import { type Ctx, isOps, Forbidden, NotFound } from "@/server/shared/authorize";
import { logActivity } from "@/server/shared/activity";
import { normaliseQuote } from "@/server/shared/compare";
import { now } from "@/server/shared/clock";
import { storeDocument } from "@/server/shared/files";
import { loadFx, ensureQuotesIn, PRE_QUOTES_STATES } from "./participations";

export type LogQuoteInput = {
  participationId: string;
  currency: string;
  unit: string;
  packQty?: number | null;
  incoterm?: string | null;
  incotermUncertain?: boolean;
  port?: string | null;
  moq?: number | null;
  leadDays?: number | null;
  leadDaysMax?: number | null;
  validUntil?: string | null;
  paymentTerms?: string | null;
  deviations?: string | null;
  unitWeightG?: number | null;
  carton?: string | null;
  notes?: string | null;
  receivedAt?: string | null;
  breaks: { minQty: number; unitPriceMinorE2: number }[];
  file?: { data: Buffer; mime: string; filename: string } | null;
};

export async function logQuote(ctx: Ctx, input: LogQuoteInput): Promise<{ quoteId: string; version: number; lineRef: string; usdMinorE2: number | null }> {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const db = await getDb();
  const at = now();
  const receivedAt = input.receivedAt ? new Date(input.receivedAt) : at;
  return db.transaction(async (tx) => {
    const [p] = await tx.select().from(supplierParticipations).where(eq(supplierParticipations.id, input.participationId)).for("update");
    if (!p || p.deletedAt) throw new NotFound("participation");
    const [line] = await tx.select().from(requestLines).where(and(eq(requestLines.id, p.requestLineId), isNull(requestLines.deletedAt))).limit(1);
    if (!line) throw new NotFound("line");
    const [sup] = await tx.select({ ref: suppliers.ref, legalName: suppliers.legalName }).from(suppliers).where(eq(suppliers.id, p.supplierId)).limit(1);
    const fx = await loadFx(tx);
    const breaks = [...input.breaks].sort((a, b) => a.minQty - b.minQty);
    const n = normaliseQuote(
      { currency: input.currency, unit: input.unit, packQty: input.packQty, incoterm: input.incoterm, incotermUncertain: input.incotermUncertain, validUntil: input.validUntil, deviations: input.deviations, receivedAt, breaks },
      { qty: line.qtyFirst ?? 0, unit: line.unit }, fx, at,
    );
    const rate = fx.rateFor(input.currency, receivedAt);
    const [prev] = await tx.select({ v: sql<number>`coalesce(max(${quotes.version}), 0)` }).from(quotes).where(eq(quotes.participationId, p.id));
    const version = Number(prev?.v ?? 0) + 1;
    let sourceDocumentId: string | null = null;
    if (input.file) {
      const r = await storeDocument(tx, { orgId: line.orgId, userId: ctx.userId, actorName: ctx.name, data: input.file.data, mime: input.file.mime, filename: input.file.filename, entity: "request_line", entityId: line.id, kind: "quote_file", visibility: "internal", at });
      sourceDocumentId = r.documentId;
    }
    const quoteId = uuidv7();
    await tx.insert(quotes).values({
      id: quoteId, participationId: p.id, version, currency: input.currency, unit: input.unit, packQty: input.packQty ?? null, incoterm: input.incoterm ?? null, incotermUncertain: !!input.incotermUncertain,
      port: input.port ?? null, moq: input.moq ?? null, leadDays: input.leadDays ?? null, leadDaysMax: input.leadDaysMax ?? null, validUntil: input.validUntil ?? null, paymentTerms: input.paymentTerms ?? null,
      deviations: input.deviations ?? null, unitWeightG: input.unitWeightG ?? null, carton: input.carton ?? null, notes: input.notes ?? null, sourceDocumentId,
      normalisedUsdMinorE2: n.usdMinorE2, fxRate: rate?.rate ?? null, fxDate: rate && rate.date ? rate.date : null, flags: n.flags, receivedAt, createdBy: ctx.userId, createdAt: at,
    });
    for (const b of breaks) await tx.insert(quotePriceBreaks).values({ id: uuidv7(), quoteId, minQty: b.minQty, unitPriceMinorE2: b.unitPriceMinorE2 });
    const status = p.status === "contacted" ? "quoted" : p.status;
    await tx.update(supplierParticipations).set({ status, lastContactAt: at, updatedAt: at }).where(eq(supplierParticipations.id, p.id));
    await logActivity(tx, {
      orgId: line.orgId, entityType: "request_line", entityId: line.id, type: "quote_logged", actorId: ctx.userId, actorName: ctx.name, visibility: "internal", at,
      payload: { ref: line.lineRef, supplierRef: sup?.ref, supplierName: sup?.legalName, participationId: p.id, quoteId, version, currency: input.currency, price: breaks[breaks.length - 1]?.unitPriceMinorE2 !== undefined ? breaks[breaks.length - 1].unitPriceMinorE2 / 10000 : null, usdMinorE2: n.usdMinorE2 },
    });
    if (status !== p.status) await logActivity(tx, { orgId: line.orgId, entityType: "request_line", entityId: line.id, type: "participation_status_changed", actorId: ctx.userId, actorName: ctx.name, visibility: "internal", at, payload: { ref: line.lineRef, supplierRef: sup?.ref, supplierName: sup?.legalName, participationId: p.id, from: p.status, status, reason: "quote logged" } });
    // QA-07: a quote on a line still in spec_frozen / cost_target_price / rfq_out moves it on to quotes_in (RFQ auto-recorded)
    if (PRE_QUOTES_STATES.includes(line.state as never)) await ensureQuotesIn(tx, line, ctx, at);
    return { quoteId, version, lineRef: line.lineRef, usdMinorE2: n.usdMinorE2 };
  });
}
