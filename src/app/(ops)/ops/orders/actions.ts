"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { authorize, OPS_ROLES } from "@/server/shared/authorize";
import { today } from "@/server/shared/clock";
import { toActionError, type ActionResult } from "@/server/shared/http";
import * as repo from "@/server/ops/orders";
import { LINE_STATES, PAYMENT_KINDS, PAYEES, LINE_EXCEPTIONS, SHIPMENT_MODES, FORWARDER_PARTIES, CUSTOMS_STATUSES, INSPECTION_RESULTS, PO_STATUSES, DOCUMENT_KINDS, COMMERCIAL_MODES, PRICING_DISPLAYS, INCOTERMS } from "@/server/ops/orders";
import { unpublishDocument, deleteDocument, previewPublish, KindNotPublishable } from "@/server/ops/documents";

const uuid = z.uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "yyyy-mm-dd");
const money = z.number().int().nonnegative().max(2_000_000_000, "Amount looks too large");
/** QA-17: dates that describe something that already happened cannot be in the future (seed clock aware). */
const pastOrToday = isoDate.refine((d) => d <= today(), "Can't be in the future");
const todayOrLater = isoDate.refine((d) => d >= today(), "Can't be in the past");

function fail(e: unknown): ActionResult<never> {
  if (e instanceof repo.OrderError || e instanceof KindNotPublishable) return { ok: false, error: e.code };
  return toActionError(e);
}
const done = (ref: string | null) => { revalidatePath("/ops/orders"); if (ref) revalidatePath(`/ops/orders/${ref}`); revalidatePath("/ops"); };

async function run<T extends { orderRef: string | null }>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try { const r = await fn(); done(r.orderRef); return { ok: true, data: r }; } catch (e) { return fail(e); }
}

/* ────────── file helper (multipart server actions) ────────── */
async function fileFrom(fd: FormData, field = "file"): Promise<{ filename: string; mime: string; data: Buffer } | null> {
  const f = fd.get(field);
  if (!(f instanceof File) || f.size === 0) return null;
  if (f.size > 25 * 1024 * 1024) throw new z.ZodError([{ code: "custom", path: [field], message: "File is larger than 25 MB", input: f.size }]);
  return { filename: f.name, mime: f.type || "application/octet-stream", data: Buffer.from(await f.arrayBuffer()) };
}

/* ────────── state ────────── */
const ChangeState = z.object({ orderId: uuid, to: z.enum(LINE_STATES), note: z.string().trim().max(500).optional(), overrideReason: z.string().trim().min(5).max(500).optional() });
export async function changeOrderStateAction(raw: z.input<typeof ChangeState>) {
  return run(async () => { const ctx = await authorize({ roles: OPS_ROLES }); const i = ChangeState.parse(raw); const r = await repo.changeOrderState(ctx, i.orderId, i.to, { note: i.note, overrideReason: i.overrideReason }); return { ...r, orderRef: await repo.getOpsOrderRefById(i.orderId) }; });
}

const SetException = z.object({ orderId: uuid, exception: z.enum(LINE_EXCEPTIONS).nullable(), reason: z.string().trim().max(500).optional() });
export async function setOrderExceptionAction(raw: z.input<typeof SetException>) {
  return run(async () => { const ctx = await authorize({ roles: OPS_ROLES }); const i = SetException.parse(raw); await repo.setOrderException(ctx, i.orderId, i.exception, i.reason); return { orderRef: await repo.getOpsOrderRefById(i.orderId) }; });
}

/* ────────── payments ────────── */
const MarkPaid = z.object({ paymentId: uuid, reference: z.string().trim().min(3, "Enter the payment reference (at least 3 characters)").max(80), paidAt: pastOrToday.optional() });
export async function markPaymentPaidAction(raw: z.input<typeof MarkPaid>) {
  return run(async () => { const ctx = await authorize({ roles: OPS_ROLES }); const i = MarkPaid.parse(raw); return repo.markPaymentPaid(ctx, i.paymentId, { reference: i.reference, paidAt: i.paidAt }); });
}
const DueDate = z.object({ paymentId: uuid, dueOn: isoDate.nullable() });
export async function setPaymentDueDateAction(raw: z.input<typeof DueDate>) {
  return run(async () => { const ctx = await authorize({ roles: OPS_ROLES }); const i = DueDate.parse(raw); return repo.setPaymentDueDate(ctx, i.paymentId, i.dueOn); });
}
const AddPayment = z.object({ orderId: uuid, kind: z.enum(PAYMENT_KINDS), amountMinor: money.positive(), dueOn: isoDate.nullable(), payee: z.enum(PAYEES) });
export async function addPaymentAction(raw: z.input<typeof AddPayment>) {
  return run(async () => { const ctx = await authorize({ roles: OPS_ROLES }); const i = AddPayment.parse(raw); return repo.addPayment(ctx, i.orderId, i); });
}
export async function waivePaymentAction(raw: { paymentId: string }) {
  return run(async () => { const ctx = await authorize({ roles: ["admin"] }); return repo.waivePayment(ctx, uuid.parse(raw.paymentId)); });
}

/* ────────── artwork ────────── */
const Decide = z.object({ artworkId: uuid, decision: z.enum(["approved", "changes_requested"]), note: z.string().trim().max(500).optional() });
export async function decideArtworkAction(raw: z.input<typeof Decide>) {
  return run(async () => { const ctx = await authorize({ roles: OPS_ROLES }); const i = Decide.parse(raw); return repo.decideArtwork(ctx, i.artworkId, i.decision, i.note); });
}
export async function setArtworkRequiredAction(raw: { orderLineId: string; required: boolean }) {
  return run(async () => { const ctx = await authorize({ roles: OPS_ROLES }); return repo.setArtworkRequired(ctx, uuid.parse(raw.orderLineId), z.boolean().parse(raw.required)); });
}
export async function uploadDielineAction(fd: FormData) {
  return run(async () => { const ctx = await authorize({ roles: OPS_ROLES }); const orderLineId = uuid.parse(fd.get("orderLineId")); const file = await fileFrom(fd); if (!file) throw new z.ZodError([{ code: "custom", path: ["file"], message: "Choose a file", input: null }]); return repo.uploadDieline(ctx, orderLineId, file); });
}

/* ────────── purchase orders + production ────────── */
const PoEta = z.object({ poId: uuid, exworksEta: todayOrLater });
export async function setPoEtaAction(raw: z.input<typeof PoEta>) {
  return run(async () => { const ctx = await authorize({ roles: OPS_ROLES }); const i = PoEta.parse(raw); return repo.setPoEta(ctx, i.poId, i.exworksEta); });
}
const UpdatePo = z.object({ poId: uuid, terms: z.string().trim().max(120).nullable().optional(), factoryTotalMinor: money.optional(), status: z.enum(PO_STATUSES).optional() });
export async function updatePoAction(raw: z.input<typeof UpdatePo>) {
  return run(async () => { const ctx = await authorize({ roles: OPS_ROLES }); const i = UpdatePo.parse(raw); return repo.updatePo(ctx, i.poId, i); });
}
const StartProd = z.object({ orderId: uuid, exworksEta: todayOrLater });
export async function startProductionAction(raw: z.input<typeof StartProd>) {
  return run(async () => { const ctx = await authorize({ roles: OPS_ROLES }); const i = StartProd.parse(raw); return repo.startProduction(ctx, i.orderId, { exworksEta: i.exworksEta }); });
}

/* ────────── inspection ────────── */
const Schedule = z.object({ orderId: uuid, inspectionId: uuid.optional(), scheduledFor: isoDate, inspector: z.string().trim().max(80).nullable(), aql: z.string().trim().max(20).nullable(), sampleSize: z.number().int().positive().max(100_000).nullable() });
export async function scheduleInspectionAction(raw: z.input<typeof Schedule>) {
  return run(async () => { const ctx = await authorize({ roles: OPS_ROLES }); const i = Schedule.parse(raw); return repo.scheduleInspection(ctx, i.orderId, i); });
}
const Record = z.object({ inspectionId: uuid, result: z.enum(INSPECTION_RESULTS), inspectedAt: pastOrToday.optional(), defectsNote: z.string().trim().max(500).nullable(), aql: z.string().trim().max(20).nullable().optional(), sampleSize: z.number().int().positive().max(100_000).nullable().optional(), visibleToClient: z.boolean().optional() });
export async function recordInspectionAction(fd: FormData) {
  return run(async () => {
    const ctx = await authorize({ roles: OPS_ROLES });
    const i = Record.parse({ inspectionId: fd.get("inspectionId"), result: fd.get("result"), inspectedAt: fd.get("inspectedAt") || undefined, defectsNote: (fd.get("defectsNote") as string | null) || null, aql: (fd.get("aql") as string | null) || null, sampleSize: fd.get("sampleSize") ? Number(fd.get("sampleSize")) : null, visibleToClient: fd.get("visibleToClient") === "on" });
    const report = await fileFrom(fd);
    return repo.recordInspection(ctx, i.inspectionId, { ...i, report });
  });
}
export async function setInspectionVisibilityAction(raw: { inspectionId: string; visible: boolean }) {
  return run(async () => { const ctx = await authorize({ roles: OPS_ROLES }); return repo.setInspectionVisibility(ctx, uuid.parse(raw.inspectionId), z.boolean().parse(raw.visible)); });
}

/* ────────── shipment ────────── */
const Forwarder = z.object({ orderId: uuid, forwarder: z.string().trim().min(2).max(120), forwarderParty: z.enum(FORWARDER_PARTIES), forwarderContact: z.string().trim().max(200).nullable(), bookingRef: z.string().trim().min(2).max(80), cargoReady: isoDate, mode: z.enum(SHIPMENT_MODES).nullable(), portOfDischarge: z.string().trim().max(80).nullable(), etaPort: isoDate.nullable(), overrideReason: z.string().trim().min(5).max(500).optional() });
export async function recordForwarderAction(raw: z.input<typeof Forwarder>) {
  return run(async () => { const ctx = await authorize({ roles: OPS_ROLES }); const i = Forwarder.parse(raw); return repo.recordForwarder(ctx, i.orderId, i); });
}
const Shipped = z.object({ orderId: uuid, exworksShippedAt: pastOrToday });
export async function markShippedAction(raw: z.input<typeof Shipped>) {
  return run(async () => { const ctx = await authorize({ roles: OPS_ROLES }); const i = Shipped.parse(raw); return repo.markShippedExworks(ctx, i.orderId, i); });
}
const Departed = z.object({ orderId: uuid, mode: z.enum(SHIPMENT_MODES), containerOrAwb: z.string().trim().min(3).max(60), etd: isoDate, etaPort: isoDate, portOfDischarge: z.string().trim().max(80).nullable() });
export async function markDepartedAction(raw: z.input<typeof Departed>) {
  return run(async () => { const ctx = await authorize({ roles: OPS_ROLES }); const i = Departed.parse(raw); return repo.markDeparted(ctx, i.orderId, i); });
}
const Arrived = z.object({ orderId: uuid, arrivedPortAt: pastOrToday });
export async function markArrivedAction(raw: z.input<typeof Arrived>) {
  return run(async () => { const ctx = await authorize({ roles: OPS_ROLES }); const i = Arrived.parse(raw); return repo.markArrived(ctx, i.orderId, i); });
}
const Customs = z.object({ orderId: uuid, customsStatus: z.enum(CUSTOMS_STATUSES) });
export async function setCustomsStatusAction(raw: z.input<typeof Customs>) {
  return run(async () => { const ctx = await authorize({ roles: OPS_ROLES }); const i = Customs.parse(raw); return repo.setCustomsStatus(ctx, i.orderId, i.customsStatus); });
}
const Delivered = z.object({ orderId: uuid, deliveredAt: pastOrToday });
export async function markDeliveredAction(raw: z.input<typeof Delivered>) {
  return run(async () => { const ctx = await authorize({ roles: OPS_ROLES }); const i = Delivered.parse(raw); return repo.markDelivered(ctx, i.orderId, i); });
}
export async function uploadShipmentDocumentAction(fd: FormData) {
  return run(async () => {
    const ctx = await authorize({ roles: OPS_ROLES });
    const orderId = uuid.parse(fd.get("orderId"));
    const kind = z.enum(["bill_of_lading", "packing_list"]).parse(fd.get("kind"));
    const file = await fileFrom(fd);
    if (!file) throw new z.ZodError([{ code: "custom", path: ["file"], message: "Choose a file", input: null }]);
    return repo.uploadShipmentDocument(ctx, orderId, kind, file, fd.get("publish") === "on");
  });
}
export async function closeOrderAction(raw: { orderId: string }) {
  return run(async () => { const ctx = await authorize({ roles: OPS_ROLES }); const id = uuid.parse(raw.orderId); const r = await repo.closeOrder(ctx, id); return { ...r, orderRef: await repo.getOpsOrderRefById(id) }; });
}

/* ────────── documents ────────── */
export async function uploadOrderDocumentAction(fd: FormData) {
  return run(async () => {
    const ctx = await authorize({ roles: OPS_ROLES });
    const orderId = uuid.parse(fd.get("orderId"));
    const kind = z.enum(DOCUMENT_KINDS).parse(fd.get("kind"));
    const file = await fileFrom(fd);
    if (!file) throw new z.ZodError([{ code: "custom", path: ["file"], message: "Choose a file", input: null }]);
    return repo.uploadOrderDocument(ctx, orderId, kind, file);
  });
}
const Publish = z.object({ orderId: uuid, documentId: uuid });
export async function publishDocumentAction(raw: z.input<typeof Publish>) {
  return run(async () => { const ctx = await authorize({ roles: OPS_ROLES }); const i = Publish.parse(raw); return repo.publishOrderDocument(ctx, i.orderId, i.documentId); });
}
export async function previewPublishAction(raw: { documentId: string }) {
  try { const ctx = await authorize({ roles: OPS_ROLES }); return { ok: true as const, data: await previewPublish(ctx, uuid.parse(raw.documentId)) }; } catch (e) { return fail(e); }
}
export async function unpublishDocumentAction(raw: z.input<typeof Publish>) {
  return run(async () => { const ctx = await authorize({ roles: OPS_ROLES }); const i = Publish.parse(raw); await unpublishDocument(ctx, i.documentId); return { orderRef: await repo.getOpsOrderRefById(i.orderId) }; });
}
export async function deleteDocumentAction(raw: z.input<typeof Publish>) {
  return run(async () => { const ctx = await authorize({ roles: OPS_ROLES }); const i = Publish.parse(raw); await deleteDocument(ctx, i.documentId); return { orderRef: await repo.getOpsOrderRefById(i.orderId) }; });
}

/* ────────── timeline ────────── */
const Note = z.object({ orderId: uuid, body: z.string().trim().min(2).max(2000), visibility: z.enum(["client", "internal"]) });
export async function postNoteAction(raw: z.input<typeof Note>) {
  return run(async () => { const ctx = await authorize({ roles: OPS_ROLES }); const i = Note.parse(raw); return repo.postOrderNote(ctx, i.orderId, i); });
}
const Wa = z.object({ orderId: uuid, counterparty: z.string().trim().min(2).max(120), body: z.string().trim().min(2).max(4000), occurredAt: z.string().optional() });
export async function logWhatsAppAction(raw: z.input<typeof Wa>) {
  return run(async () => { const ctx = await authorize({ roles: OPS_ROLES }); const i = Wa.parse(raw); return repo.logWhatsApp(ctx, i.orderId, i); });
}
const Answer = z.object({ orderId: uuid, body: z.string().trim().min(2).max(2000) });
export async function answerQuestionAction(raw: z.input<typeof Answer>) {
  return run(async () => { const ctx = await authorize({ roles: OPS_ROLES }); const i = Answer.parse(raw); return repo.answerQuestion(ctx, i.orderId, i.body); });
}

/* ────────── confirm order ────────── */
const Create = z.object({
  requestId: uuid,
  lines: z.array(z.object({ requestLineId: uuid, artworkRequired: z.boolean() })).min(1),
  commercialMode: z.enum(COMMERCIAL_MODES), pricingDisplay: z.enum(PRICING_DISPLAYS), incoterm: z.enum(INCOTERMS), port: z.string().trim().max(80).nullable(), piNumber: z.string().trim().max(60).nullable(),
  depositPct: z.number().int().min(0).max(100), feeMinor: money,
});
export async function createOrderAction(raw: z.input<typeof Create>): Promise<ActionResult<{ orderId: string; ref: string }>> {
  let ref: string;
  try {
    const ctx = await authorize({ roles: OPS_ROLES });
    const i = Create.parse(raw);
    const r = await repo.createOrderFromAccepted(ctx, i);
    ref = r.ref;
    revalidatePath("/ops/orders"); revalidatePath("/ops"); revalidatePath("/ops/requests"); revalidatePath("/ops/queue");
  } catch (e) { return fail(e); }
  redirect(`/ops/orders/${ref}`);
}
