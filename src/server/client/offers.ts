/**
 * Client offer page (SPEC F-08): read through ClientOfferDto (never draft), accept / ask for changes / decline
 * with the SPEC 3.4 side effects. App schema only.
 */
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { getDb, type DbOrTx } from "@/db";
import { requestLines, offers, offerOptions, samples, comments, payments } from "@/db/schema/app";
import { type Ctx, isClient, Forbidden, NotFound } from "@/server/shared/authorize";
import { logActivity } from "@/server/shared/activity";
import { transition, setException } from "@/server/shared/transition";
import { enqueue } from "@/server/shared/outbox";
import { opsUsers } from "@/server/shared/users";
import { now, today } from "@/server/shared/clock";
import { sampleRef } from "@/server/shared/ids";
import { ClientOfferDto, ClientOfferOptionDto } from "./dto";
import { unitPriceAtQty } from "./lines";

async function offerByRef(db: DbOrTx, ctx: Ctx, ref: string) {
  const [o] = await db.select().from(offers).where(and(eq(offers.ref, ref), eq(offers.orgId, ctx.orgId), isNull(offers.deletedAt))).limit(1);
  if (!o || o.status === "draft") throw new NotFound("offer");
  const [line] = await db.select().from(requestLines).where(and(eq(requestLines.id, o.requestLineId), eq(requestLines.orgId, ctx.orgId))).limit(1);
  if (!line) throw new NotFound("offer");
  return { o, line };
}

export async function buildClientOffer(db: DbOrTx, o: typeof offers.$inferSelect, line: { lineRef: string; name: string; qtyFirst: number | null }) {
  const opts = await db.select().from(offerOptions).where(eq(offerOptions.offerId, o.id)).orderBy(offerOptions.label);
  const priced = opts.map((x) => ({ x, e2: unitPriceAtQty(x.priceBreaks, line.qtyFirst) }));
  // "Recommended" = the agent's first choice (option A); an accepted offer highlights the accepted option instead
  const recommendedId = opts.find((x) => x.label === "A")?.id ?? null;
  return ClientOfferDto.parse({
    id: o.id, ref: o.ref, lineRef: line.lineRef, lineName: line.name, qty: line.qtyFirst, version: o.version, status: o.status, pricingDisplay: o.pricingDisplay, incoterm: o.incoterm, port: o.port,
    noteFromUs: o.noteToClient, validUntil: o.validUntil, sentAt: o.sentAt?.toISOString() ?? null, decidedAt: o.decidedAt?.toISOString() ?? null,
    acceptedOptionLabel: opts.find((x) => x.id === o.acceptedOptionId)?.label ?? null,
    options: priced.map(({ x, e2 }) => ClientOfferOptionDto.parse({
      id: x.id, label: x.label, unit: x.unit, currency: o.currency, moq: x.moq, leadDays: x.leadDays, priceBreaks: x.priceBreaks.map((b) => ({ minQty: b.min_qty, unitPriceMinorE2: b.unit_price_minor_e2 })),
      unitPriceMinorE2: e2, fee: o.pricingDisplay === "factory_plus_fee" ? { minor: x.feeMinor, currency: o.currency } : null, deviations: x.deviationsPlain,
      sampleCost: x.sampleCostMinor !== null ? { minor: x.sampleCostMinor, currency: o.currency } : null, samplePaidBy: x.samplePaidBy, sampleRequired: x.sampleRequired, paymentTerms: x.paymentTermsClient,
      recommended: opts.length > 1 && (o.acceptedOptionId ? o.acceptedOptionId === x.id : recommendedId === x.id),
    })),
    canDecide: o.status === "sent" && (!o.validUntil || o.validUntil >= today()),
  });
}

export async function getClientOffer(ctx: Ctx, ref: string) {
  if (!isClient(ctx)) throw new Forbidden("clients only");
  const db = await getDb();
  const { o, line } = await offerByRef(db, ctx, ref);
  const dto = await buildClientOffer(db, o, line);
  const others = await db.select({ ref: offers.ref, version: offers.version, status: offers.status }).from(offers).where(and(eq(offers.requestLineId, line.id), isNull(offers.deletedAt))).orderBy(desc(offers.version));
  return { offer: dto, versions: others.filter((x) => x.status !== "draft").map((x) => ({ ref: x.ref, version: x.version, status: x.status })) };
}

async function notifyAgent(tx: DbOrTx, line: typeof requestLines.$inferSelect, action: string, entityRef: string, at: Date, orgName: string) {
  const recipients = (await opsUsers(tx)).filter((u) => (line.assignedAgentId ? u.id === line.assignedAgentId : true));
  for (const u of recipients) await enqueue({ userId: u.id, toEmail: u.email, template: "ops_client_action", entityRef, subject: `${orgName}: ${action} on ${entityRef}`, payload: { ref: entityRef, lineRef: line.lineRef, action, url: `/ops/lines/${line.lineRef}?tab=offer` }, idempotencyKey: `ops_client_action:${entityRef}:${action}:${at.toISOString()}:${u.id}`, at }, tx);
}

async function orgName(db: DbOrTx, orgId: string) {
  const { organizations } = await import("@/db/schema/app");
  const [o] = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, orgId)).limit(1);
  return o?.name ?? "Client";
}

/** Accept option → sampling (sample_required) or offer_accepted. */
export async function acceptOffer(ctx: Ctx, input: { ref: string; optionLabel: "A" | "B" | "C" }) {
  if (!isClient(ctx)) throw new Forbidden("clients only");
  const db = await getDb();
  const at = now();
  return db.transaction(async (tx) => {
    const { o, line } = await offerByRef(tx, ctx, input.ref);
    if (o.status !== "sent") throw new Forbidden("offer not open");
    if (o.validUntil && o.validUntil < today()) throw new Forbidden("offer expired");
    const [opt] = await tx.select().from(offerOptions).where(and(eq(offerOptions.offerId, o.id), eq(offerOptions.label, input.optionLabel))).limit(1);
    if (!opt) throw new NotFound("option");
    await tx.update(offers).set({ status: "accepted", acceptedOptionId: opt.id, decidedAt: at, decidedBy: ctx.userId, updatedAt: at }).where(eq(offers.id, o.id));
    if (opt.participationId) await tx.update(requestLines).set({ selectedParticipationId: opt.participationId, updatedAt: at }).where(eq(requestLines.id, line.id));
    await logActivity(tx, { orgId: line.orgId, entityType: "request_line", entityId: line.id, type: "offer_decided", actorId: ctx.userId, actorName: ctx.name, visibility: "client", at, payload: { ref: line.lineRef, offerRef: o.ref, decision: "accepted", option: opt.label, text: `Offer accepted (Option ${opt.label})` } });
    const name = await orgName(tx, ctx.orgId);
    if (opt.sampleRequired) {
      await transition(line.id, "sampling", ctx, { tx, at, clearException: true });
      const id = uuidv7();
      const [cnt] = await tx.select({ n: sql<number>`count(*)` }).from(samples).where(eq(samples.requestLineId, line.id));
      const finalRef = sampleRef(line.lineRef, Number(cnt?.n ?? 0) + 1);
      await tx.insert(samples).values({ id, ref: finalRef, orgId: line.orgId, requestLineId: line.id, participationId: opt.participationId, status: "ordered", costMinor: opt.sampleCostMinor, currency: o.currency, paidBy: opt.samplePaidBy, orderedAt: at, createdBy: ctx.userId, createdAt: at, updatedAt: at });
      if (opt.samplePaidBy === "client" && opt.sampleCostMinor) await tx.insert(payments).values({ id: uuidv7(), orgId: line.orgId, requestLineId: line.id, kind: "sample", amountMinor: opt.sampleCostMinor, currency: o.currency, payee: "agency", status: "pending", createdBy: ctx.userId, createdAt: at, updatedAt: at });
      await logActivity(tx, { orgId: line.orgId, entityType: "request_line", entityId: line.id, type: "sample_created", actorId: ctx.userId, actorName: ctx.name, visibility: "client", at, payload: { ref: line.lineRef, sampleRef: finalRef, text: "Sample ordered" } });
    } else {
      await transition(line.id, "offer_accepted", ctx, { tx, at, clearException: true });
    }
    await notifyAgent(tx, line, `accepted option ${opt.label}`, o.ref, at, name);
    return { lineRef: line.lineRef, sampleRequired: opt.sampleRequired };
  });
}

/** Ask for changes: offers.status=changes_requested, exception change_requested, comment change_request, outbox ops_client_action. */
export async function requestOfferChanges(ctx: Ctx, input: { ref: string; text: string }) {
  if (!isClient(ctx)) throw new Forbidden("clients only");
  const db = await getDb();
  const at = now();
  return db.transaction(async (tx) => {
    const { o, line } = await offerByRef(tx, ctx, input.ref);
    if (o.status !== "sent") throw new Forbidden("offer not open");
    await tx.update(offers).set({ status: "changes_requested", changesText: input.text.trim(), decidedAt: at, decidedBy: ctx.userId, updatedAt: at }).where(eq(offers.id, o.id));
    await tx.insert(comments).values({ id: uuidv7(), orgId: line.orgId, entityType: "request_line", entityId: line.id, authorId: ctx.userId, authorName: ctx.name, body: input.text.trim(), kind: "change_request", visibility: "client", source: "app", createdBy: ctx.userId, createdAt: at, updatedAt: at });
    await logActivity(tx, { orgId: line.orgId, entityType: "request_line", entityId: line.id, type: "offer_decided", actorId: ctx.userId, actorName: ctx.name, visibility: "client", at, payload: { ref: line.lineRef, offerRef: o.ref, decision: "changes_requested", text: "Changes requested on the offer" } });
    await setException({ lineId: line.id }, "change_requested", ctx, { tx, at, reason: input.text.trim().slice(0, 200) });
    await notifyAgent(tx, line, "asked for changes", o.ref, at, await orgName(tx, ctx.orgId));
    return { lineRef: line.lineRef };
  });
}

export const DECLINE_REASONS = ["too_expensive", "lead_time", "spec", "no_longer_needed", "other"] as const;
export type DeclineReason = (typeof DECLINE_REASONS)[number];

/** Decline: offers.status=declined + reason comment; no exception (waiting_on = agency via offer_followup). */
export async function declineOffer(ctx: Ctx, input: { ref: string; reason: DeclineReason; text?: string | null }) {
  if (!isClient(ctx)) throw new Forbidden("clients only");
  const db = await getDb();
  const at = now();
  return db.transaction(async (tx) => {
    const { o, line } = await offerByRef(tx, ctx, input.ref);
    if (o.status !== "sent") throw new Forbidden("offer not open");
    const body = `${input.reason.replace(/_/g, " ")}${input.text?.trim() ? ` — ${input.text.trim()}` : ""}`;
    await tx.update(offers).set({ status: "declined", declineReason: input.reason, changesText: input.text?.trim() || null, decidedAt: at, decidedBy: ctx.userId, updatedAt: at }).where(eq(offers.id, o.id));
    await tx.insert(comments).values({ id: uuidv7(), orgId: line.orgId, entityType: "request_line", entityId: line.id, authorId: ctx.userId, authorName: ctx.name, body, kind: "decline_reason", visibility: "client", source: "app", createdBy: ctx.userId, createdAt: at, updatedAt: at });
    await logActivity(tx, { orgId: line.orgId, entityType: "request_line", entityId: line.id, type: "offer_decided", actorId: ctx.userId, actorName: ctx.name, visibility: "client", at, payload: { ref: line.lineRef, offerRef: o.ref, decision: "declined", reason: input.reason, text: "Offer declined" } });
    await notifyAgent(tx, line, "declined the offer", o.ref, at, await orgName(tx, ctx.orgId));
    return { lineRef: line.lineRef };
  });
}
