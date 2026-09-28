/**
 * Offer builder (SPEC F-18): draft/save/send with the leak check on every text field, pricing display rules,
 * → offer_ready, `client_offer_ready` outbox row (milestone email suppressed), previous `sent` offer → expired.
 */
import { ZodError } from "zod";
import { and, desc, eq, isNull } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { getDb } from "@/db";
import { requestLines, organizations, offers, offerOptions } from "@/db/schema/app";
import { supplierParticipations } from "@/db/schema/supplier";
import type { PriceBreak } from "@/db/types";
import type { SamplePaidBy } from "@/db/enums";
import { type Ctx, isOps, Forbidden, NotFound } from "@/server/shared/authorize";
import { logActivity } from "@/server/shared/activity";
import { transition } from "@/server/shared/transition";
import { enqueue } from "@/server/shared/outbox";
import { clientUsersOf } from "@/server/shared/users";
import { now, today } from "@/server/shared/clock";
import { offerRef } from "@/server/shared/ids";
import { assertClean, loadLeakSources } from "@/server/shared/leak-check";
import { lineById, ensureQuotesIn, PRE_QUOTES_STATES } from "./participations";
import type { State } from "@/server/shared/state-machine";

export type OfferOptionInput = {
  label: "A" | "B" | "C";
  participationId: string;
  moq?: number | null;
  leadDays?: number | null;
  priceBreaks: PriceBreak[];
  feeMinor: number;
  factoryPriceMinorE2?: number | null;
  deviationsPlain: string;
  sampleCostMinor?: number | null;
  samplePaidBy?: SamplePaidBy | null;
  sampleRequired: boolean;
  paymentTermsClient?: string | null;
  internalNote?: string | null;
};
export type SaveOfferInput = {
  lineId: string;
  offerId?: string | null;
  incoterm: string;
  port?: string | null;
  validUntil: string;
  noteToClient?: string | null;
  options: OfferOptionInput[];
};

export { prefillClientPriceE2, prefillFeeMinor } from "@/components/ops/board/pure";
export const defaultValidUntil = () => { const d = new Date(now()); d.setUTCDate(d.getUTCDate() + 14); return d.toISOString().slice(0, 10); };
export const DEFAULT_PAYMENT_TERMS = "30 % deposit + fee on order, 70 % after QC pass";

function validate(input: SaveOfferInput, pricingDisplay: string, send: boolean) {
  const errors: Record<string, string> = {};
  if (!input.options.length) errors._ = "Add at least one option";
  if (input.options.length > 3) errors._ = "At most three options";
  for (const o of input.options) {
    const k = `option${o.label}`;
    if (!o.participationId) errors[`${k}.participationId`] = "Pick a quote";
    if (!o.priceBreaks.length || o.priceBreaks.some((b) => !(b.min_qty > 0) || !(b.unit_price_minor_e2 > 0))) errors[`${k}.priceBreaks`] = "Ladder needs ≥ 1 row with qty and price";
    if (send && (o.deviationsPlain ?? "").trim().length < 3) errors[`${k}.deviationsPlain`] = "Deviations text required (≥ 3 chars, e.g. \"none\")";
    if (pricingDisplay === "all_in" && o.feeMinor > 0) errors[`${k}.feeMinor`] = "Fee must be 0 for an all-in client";
    if (o.feeMinor < 0) errors[`${k}.feeMinor`] = "Fee cannot be negative";
    if (o.feeMinor > 100_000_000) errors[`${k}.feeMinor`] = "Fee looks too large";
    if (o.priceBreaks.some((b) => b.min_qty > 100_000_000 || b.unit_price_minor_e2 > 1_000_000_000)) errors[`${k}.priceBreaks`] = "Quantity or price looks too large";
    // QA-22: a sample the client must take needs a cost (0 when free) and who pays it
    if (send && o.sampleRequired && (o.sampleCostMinor === null || o.sampleCostMinor === undefined)) errors[`${k}.sampleCostMinor`] = "Enter the sample cost (0 if free)";
    if (send && o.sampleRequired && (o.sampleCostMinor ?? 0) > 0 && !o.samplePaidBy) errors[`${k}.samplePaidBy`] = "Choose who pays for the sample";
    if ((o.sampleCostMinor ?? 0) < 0) errors[`${k}.sampleCostMinor`] = "Sample cost cannot be negative";
  }
  if (send && !/^\d{4}-\d{2}-\d{2}$/.test(input.validUntil)) errors.validUntil = "Valid-until date required";
  if (send && input.validUntil < today()) errors.validUntil = "Valid-until must be in the future";
  return errors;
}

/** Save draft (send=false) or Send (send=true). Returns the offer ref. */
export async function saveOffer(ctx: Ctx, input: SaveOfferInput, opts: { send: boolean }) {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const db = await getDb();
  const at = now();
  return db.transaction(async (tx) => {
    const line = await lineById(tx, input.lineId);
    const [org] = await tx.select().from(organizations).where(eq(organizations.id, line.orgId)).limit(1);
    if (input.incoterm !== "FOB" && ctx.role !== "admin") { throw new ZodError([{ code: "custom", path: ["incoterm"], message: "Incoterm must be FOB (admin may override)", input: input.incoterm } as never]); }
    const errors = validate(input, org.pricingDisplay, opts.send);
    if (Object.keys(errors).length) { throw new ZodError(Object.entries(errors).map(([path, message]) => ({ code: "custom", path: path.split("."), message, input: null }) as never)); }
    // every option must point at a participation of this line with ≥ 1 quote
    const parts = await tx.select({ id: supplierParticipations.id, status: supplierParticipations.status }).from(supplierParticipations).where(and(eq(supplierParticipations.requestLineId, line.id), isNull(supplierParticipations.deletedAt)));
    const ids = new Set(parts.map((p) => p.id));
    for (const o of input.options) if (!ids.has(o.participationId)) throw new NotFound(`participation for option ${o.label}`);
    // QA-27: a dropped / cannot-make supplier is not an option source
    const dead = input.options.filter((o) => parts.some((p) => p.id === o.participationId && (p.status === "dropped" || p.status === "cannot_make")));
    if (dead.length) throw new ZodError(dead.map((o) => ({ code: "custom", path: [`option${o.label}`, "participationId"], message: "This supplier was dropped — pick another quote", input: null }) as never));
    if (opts.send) {
      const sources = await loadLeakSources(tx);
      const fields: Record<string, string | null | undefined> = { "Note to client": input.noteToClient, Port: input.port };
      for (const o of input.options) { fields[`Option ${o.label} › deviations`] = o.deviationsPlain; fields[`Option ${o.label} › payment terms`] = o.paymentTermsClient; }
      // QA-06: an offer is about the factory by construction → city names count (an inland factory city as "port" is blocked)
      assertClean({ fields, factoryContext: true }, sources);
    }
    // draft row: reuse the line's draft (or the given offerId if still draft), else new version
    const existing = await tx.select().from(offers).where(and(eq(offers.requestLineId, line.id), isNull(offers.deletedAt))).orderBy(desc(offers.version));
    let draft = existing.find((o) => o.status === "draft" && (!input.offerId || o.id === input.offerId)) ?? null;
    if (!draft) {
      const version = (existing[0]?.version ?? 0) + 1;
      const id = uuidv7();
      await tx.insert(offers).values({ id, ref: offerRef(line.lineRef, version), orgId: line.orgId, requestLineId: line.id, version, status: "draft", pricingDisplay: org.pricingDisplay, currency: "USD", incoterm: input.incoterm, port: input.port ?? null, noteToClient: input.noteToClient ?? null, validUntil: input.validUntil || null, createdBy: ctx.userId, createdAt: at, updatedAt: at });
      draft = (await tx.select().from(offers).where(eq(offers.id, id)).limit(1))[0];
    } else {
      await tx.update(offers).set({ incoterm: input.incoterm, port: input.port ?? null, noteToClient: input.noteToClient ?? null, validUntil: input.validUntil || null, pricingDisplay: org.pricingDisplay, updatedAt: at }).where(eq(offers.id, draft.id));
      await tx.delete(offerOptions).where(eq(offerOptions.offerId, draft.id));
    }
    const optionIds: Record<string, string> = {};
    for (const o of [...input.options].sort((a, b) => a.label.localeCompare(b.label))) {
      const id = uuidv7(); optionIds[o.label] = id;
      await tx.insert(offerOptions).values({
        id, offerId: draft.id, label: o.label, participationId: o.participationId as never, unit: line.unit, moq: o.moq ?? null, leadDays: o.leadDays ?? null, priceBreaks: [...o.priceBreaks].sort((a, b) => a.min_qty - b.min_qty),
        feeMinor: o.feeMinor, factoryPriceMinorE2: o.factoryPriceMinorE2 ?? null, deviationsPlain: o.deviationsPlain, sampleCostMinor: o.sampleCostMinor ?? null, samplePaidBy: o.samplePaidBy ?? null,
        sampleRequired: o.sampleRequired, paymentTermsClient: o.paymentTermsClient ?? DEFAULT_PAYMENT_TERMS, internalNote: o.internalNote ?? null, createdAt: at,
      });
    }
    if (!opts.send) {
      await logActivity(tx, { orgId: line.orgId, entityType: "offer", entityId: draft.id, type: "line_updated", actorId: ctx.userId, actorName: ctx.name, visibility: "internal", at, payload: { ref: draft.ref, lineRef: line.lineRef, text: `Offer draft v${draft.version} saved` } });
      await logActivity(tx, { orgId: line.orgId, entityType: "request_line", entityId: line.id, type: "line_updated", actorId: ctx.userId, actorName: ctx.name, visibility: "internal", at, payload: { ref: line.lineRef, text: `Offer draft v${draft.version} saved` } });
      return { offerId: draft.id, offerRef: draft.ref, version: draft.version, sent: false, lineRef: line.lineRef };
    }
    // send
    for (const o of existing) if (o.status === "sent" && o.id !== draft.id) await tx.update(offers).set({ status: "expired", updatedAt: at }).where(eq(offers.id, o.id));
    await tx.update(offers).set({ status: "sent", sentAt: at, updatedAt: at }).where(eq(offers.id, draft.id));
    const optionA = input.options.find((o) => o.label === "A") ?? input.options[0];
    const linePatch: Partial<typeof requestLines.$inferInsert> = { updatedAt: at };
    if (!line.selectedParticipationId) linePatch.selectedParticipationId = optionA.participationId as never;
    await tx.update(requestLines).set(linePatch).where(eq(requestLines.id, line.id));
    await logActivity(tx, { orgId: line.orgId, entityType: "request_line", entityId: line.id, type: "offer_sent", actorId: ctx.userId, actorName: ctx.name, visibility: "client", at, payload: { ref: line.lineRef, offerRef: draft.ref, version: draft.version, text: `Price ready — offer v${draft.version}` } });
    let from = line.state as State;
    // QA-07: quotes were logged before "Mark RFQ sent" → catch the line up first
    if (PRE_QUOTES_STATES.includes(from)) from = await ensureQuotesIn(tx, line, ctx, new Date(at.getTime() - 10));
    if (from === "quotes_in" || from === "shortlisted" || from === "negotiating") await transition(line.id, "offer_ready", ctx, { tx, at, notifyClient: false, clearException: true });
    else if (from === "offer_ready") await tx.update(requestLines).set({ exception: null, exceptionReason: null, lastStateChangeAt: at, staleSince: null }).where(eq(requestLines.id, line.id));
    else throw new (await import("@/server/shared/state-machine")).IllegalTransition(from, "offer_ready");
    for (const u of await clientUsersOf(tx, line.orgId)) {
      await enqueue({ userId: u.id, toEmail: u.email, template: "client_offer_ready", entityRef: draft.ref, subject: `Price ready — ${line.name}`, payload: { ref: draft.ref, lineRef: line.lineRef, name: line.name, version: draft.version, validUntil: input.validUntil, url: `/app/offers/${draft.ref}` }, idempotencyKey: `client_offer_ready:${draft.id}:${u.id}`, at }, tx);
    }
    return { offerId: draft.id, offerRef: draft.ref, version: draft.version, sent: true, lineRef: line.lineRef };
  });
}
