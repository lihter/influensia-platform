/**
 * QA-05 / F-12 reorder fast path (AC-REO-01/02). Shared (not client) because it touches the supplier schema; the client
 * reorder code calls it and gets back only a boolean — no supplier data crosses into client code.
 *
 * When the supplier of the previous order line still has a VALID quote (valid_until ≥ today):
 * - a `selected` participation for that supplier (same contact) is created on the new line, with the latest quote copied
 *   onto it (so the sourcing board and the Offer tab have a source),
 * - `selected_participation_id` points at it,
 * - a DRAFT offer v1 is prefilled from the last accepted offer of the previous line (same ladder, fee, terms, port),
 *   no sample (repeat order).
 * The caller then inserts the line in `negotiating` ("Repeat order — price being confirmed"). Otherwise → in_review.
 */
import { and, desc, eq, isNull } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import type { DbOrTx } from "@/db";
import { requestLines, offers, offerOptions } from "@/db/schema/app";
import { supplierParticipations, quotes, quotePriceBreaks } from "@/db/schema/supplier";
import { logActivity } from "./activity";
import { offerRef } from "./ids";
import { today } from "./clock";
import type { Ctx } from "./authorize";

export type FastPathInput = {
  newLineId: string;
  newLineRef: string;
  orgId: string;
  /** order_lines.participation_id of the previous order line (ServerOnly column) */
  previousParticipationId: string | null;
  /** the previous request line (for its last accepted offer) */
  previousLineId: string;
  at: Date;
};

/** Pure: is a quote still usable for a repeat order today? */
export const quoteStillValid = (validUntil: string | null | undefined, on: string = today()) => !!validUntil && validUntil >= on;

export async function tryReorderFastPath(tx: DbOrTx, ctx: Ctx, p: FastPathInput): Promise<{ fastPath: boolean }> {
  if (!p.previousParticipationId) return { fastPath: false };
  const [prev] = await tx.select().from(supplierParticipations).where(eq(supplierParticipations.id, p.previousParticipationId)).limit(1);
  if (!prev || prev.deletedAt) return { fastPath: false };
  const [q] = await tx.select().from(quotes).where(eq(quotes.participationId, prev.id)).orderBy(desc(quotes.version)).limit(1);
  if (!q || !quoteStillValid(q.validUntil)) return { fastPath: false };

  const at = p.at;
  const participationId = uuidv7();
  await tx.insert(supplierParticipations).values({
    id: participationId, requestLineId: p.newLineId, supplierId: prev.supplierId, contactId: prev.contactId, status: "selected", reason: "Repeat order — same supplier",
    firstContactAt: at, lastContactAt: at, createdBy: ctx.userId, createdAt: at, updatedAt: at,
  });
  const quoteId = uuidv7();
  const { id: _oldId, participationId: _oldPart, createdAt: _c, createdBy: _cb, ...rest } = q;
  void _oldId; void _oldPart; void _c; void _cb;
  await tx.insert(quotes).values({ ...rest, id: quoteId, participationId, version: 1, notes: `Copied from the previous order's quote (valid until ${q.validUntil})`, createdBy: ctx.userId, createdAt: at });
  const breaks = await tx.select().from(quotePriceBreaks).where(eq(quotePriceBreaks.quoteId, q.id));
  for (const b of breaks) await tx.insert(quotePriceBreaks).values({ id: uuidv7(), quoteId, minQty: b.minQty, unitPriceMinorE2: b.unitPriceMinorE2 });
  await tx.update(requestLines).set({ selectedParticipationId: participationId as never, updatedAt: at }).where(eq(requestLines.id, p.newLineId));
  await logActivity(tx, { orgId: p.orgId, entityType: "request_line", entityId: p.newLineId, type: "participation_added", actorId: ctx.userId, actorName: ctx.name, visibility: "internal", at, payload: { ref: p.newLineRef, status: "selected", source: "reorder", text: `Repeat order: previous supplier pre-selected (quote valid until ${q.validUntil})` } });

  // draft offer prefilled from the previous line's last accepted offer
  const [lastOffer] = await tx.select().from(offers).where(and(eq(offers.requestLineId, p.previousLineId), eq(offers.status, "accepted"), isNull(offers.deletedAt))).orderBy(desc(offers.version)).limit(1);
  const [opt] = lastOffer?.acceptedOptionId ? await tx.select().from(offerOptions).where(eq(offerOptions.id, lastOffer.acceptedOptionId)).limit(1) : [];
  if (lastOffer && opt) {
    const offerId = uuidv7();
    const valid = new Date(at); valid.setUTCDate(valid.getUTCDate() + 14);
    await tx.insert(offers).values({
      id: offerId, ref: offerRef(p.newLineRef, 1), orgId: p.orgId, requestLineId: p.newLineId, version: 1, status: "draft", pricingDisplay: lastOffer.pricingDisplay, currency: lastOffer.currency,
      incoterm: lastOffer.incoterm, port: lastOffer.port, noteToClient: null, validUntil: valid.toISOString().slice(0, 10), createdBy: ctx.userId, createdAt: at, updatedAt: at,
    });
    await tx.insert(offerOptions).values({
      id: uuidv7(), offerId, label: "A", participationId: participationId as never, unit: opt.unit, moq: opt.moq, leadDays: opt.leadDays, priceBreaks: opt.priceBreaks, feeMinor: opt.feeMinor,
      factoryPriceMinorE2: opt.factoryPriceMinorE2, deviationsPlain: opt.deviationsPlain, sampleCostMinor: null, samplePaidBy: null, sampleRequired: false, paymentTermsClient: opt.paymentTermsClient,
      internalNote: `Prefilled from ${lastOffer.ref} (repeat order)`, createdAt: at,
    });
    await logActivity(tx, { orgId: p.orgId, entityType: "request_line", entityId: p.newLineId, type: "line_updated", actorId: ctx.userId, actorName: ctx.name, visibility: "internal", at, payload: { ref: p.newLineRef, text: `Offer draft v1 prefilled from ${lastOffer.ref}` } });
  }
  return { fastPath: true };
}
