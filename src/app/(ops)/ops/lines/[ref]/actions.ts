"use server";
/**
 * Server actions for the ops line page (SPEC F-15…F-20). Every action: authorize(ops) → zod → one repository call →
 * revalidatePath → ActionResult. File uploads arrive as FormData.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize, OPS_ROLES } from "@/server/shared/authorize";
import { toActionError, type ActionResult } from "@/server/shared/http";
import { PARTICIPATION_STATUSES, CONTACT_CHANNELS, INCOTERMS, SAMPLE_PAID_BY, LINE_STATES, PRODUCT_CATEGORIES, UNITS, searchSuppliers, addParticipation, setParticipationStatus, updateParticipation, markRfqSent, changeLineState, shortlistParticipations, previewNormalisation } from "@/server/ops/participations";
import { logQuote } from "@/server/ops/quotes";
import { saveSpec, freezeSpec, uploadSupplierFacingImage, saveCostModel, confirmTarget } from "@/server/ops/cost";
import { saveOffer } from "@/server/ops/offers";
import { createSample, setSampleStatus, uploadSamplePhoto, skipSample, reSource } from "@/server/ops/samples";
import { addInternalNote, logWhatsApp, askClient, replyToClient, setLineException, clearLineException, resolveChangeRequest, resolveQuestion } from "@/server/ops/comments";
import { postClientUpdate } from "@/server/ops/publish";

const uuid = z.uuid();
const optStr = z.string().trim().max(4000).nullish();
/** QA-13/QA-15: every integer is bounded (Postgres int4) and every message is human (see humanIssue in shared/http). */
const MAX_INT = 2_000_000_000;
const optInt = z.coerce.number().int().nonnegative().max(MAX_INT).nullish();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const refresh = (lineRef: string) => { revalidatePath(`/ops/lines/${lineRef}`); revalidatePath("/ops"); revalidatePath(`/app/lines/${lineRef}`); };

async function run<T extends { lineRef: string }>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try { const r = await fn(); refresh(r.lineRef); return { ok: true, data: r }; } catch (e) { return toActionError(e); }
}

async function fileFrom(fd: FormData, field: string): Promise<{ data: Buffer; mime: string; filename: string } | null> {
  const f = fd.get(field);
  if (!(f instanceof File) || f.size === 0) return null;
  if (f.size > 25 * 1024 * 1024) throw new z.ZodError([{ code: "custom", path: [field], message: "File larger than 25 MB", input: f.size } as never]);
  return { data: Buffer.from(await f.arrayBuffer()), mime: f.type || "application/octet-stream", filename: f.name };
}
async function filesFrom(fd: FormData, field: string) {
  const out: { data: Buffer; mime: string; filename: string }[] = [];
  for (const f of fd.getAll(field)) if (f instanceof File && f.size > 0) out.push({ data: Buffer.from(await f.arrayBuffer()), mime: f.type || "application/octet-stream", filename: f.name });
  return out;
}

/* ───────── header ───────── */
const ChangeState = z.object({ lineId: uuid, to: z.enum(LINE_STATES), note: optStr, override: z.boolean().optional(), reason: optStr });
export async function changeLineStateAction(raw: z.input<typeof ChangeState>) {
  return run(async () => { const ctx = await authorize({ roles: OPS_ROLES }); return changeLineState(ctx, ChangeState.parse(raw)); });
}

/* ───────── spec ───────── */
const SpecField = z.object({ key: z.string().trim().min(1).max(60), value: z.union([z.string().trim().max(500), z.number(), z.boolean()]) });
const Spec = z.object({
  lineId: uuid, productName: z.string().trim().min(1).max(200), category: z.enum(PRODUCT_CATEGORIES).nullish(), hsCode: z.string().trim().regex(/^\d{6,10}$/).nullish().or(z.literal("").transform(() => null)),
  unit: z.enum(UNITS), materials: optStr, customisation: optStr, artworkRequired: z.boolean().optional(), sampleRequired: z.boolean().optional(), fields: z.array(SpecField).max(40),
});
export async function saveSpecAction(raw: z.input<typeof Spec>) { return run(async () => saveSpec(await authorize({ roles: OPS_ROLES }), Spec.parse(raw))); }
export async function freezeSpecAction(raw: z.input<typeof Spec>) { return run(async () => freezeSpec(await authorize({ roles: OPS_ROLES }), Spec.parse(raw))); }
export async function uploadSupplierImageAction(fd: FormData) {
  return run(async () => {
    const ctx = await authorize({ roles: OPS_ROLES });
    const { lineId, kind } = z.object({ lineId: uuid, kind: z.enum(["supplier_facing", "clean"]).default("supplier_facing") }).parse({ lineId: fd.get("lineId"), kind: fd.get("kind") ?? undefined });
    const file = await fileFrom(fd, "file");
    if (!file) throw new z.ZodError([{ code: "custom", path: ["file"], message: "Choose an image", input: null } as never]);
    if (!/^image\//.test(file.mime)) throw new z.ZodError([{ code: "custom", path: ["file"], message: "Images only", input: file.mime } as never]);
    return uploadSupplierFacingImage(ctx, { lineId, kind, ...file });
  });
}

/* ───────── cost & target ───────── */
const Cost = z.object({ lineId: uuid, materialFloorMinorE2: optInt, processCostMinorE2: optInt, packagingMinorE2: optInt, overheadPct: z.coerce.number().min(0).max(100).nullish(), estProdCostMinorE2: z.coerce.number().int().positive("Estimated production cost must be above 0").max(MAX_INT), method: optStr, notes: optStr, upliftPct: z.coerce.number().min(0, "Uplift can't be negative").max(500, "Uplift can be at most 500 %") });
export async function saveCostModelAction(raw: z.input<typeof Cost>) { return run(async () => saveCostModel(await authorize({ roles: OPS_ROLES }), Cost.parse(raw))); }
export async function confirmTargetAction(raw: { lineId: string }) { return run(async () => confirmTarget(await authorize({ roles: OPS_ROLES }), z.object({ lineId: uuid }).parse(raw))); }

/* ───────── sourcing board ───────── */
export async function searchSuppliersAction(raw: { q: string; lineId?: string }): Promise<ActionResult<Awaited<ReturnType<typeof searchSuppliers>>>> {
  try { const ctx = await authorize({ roles: OPS_ROLES }); const i = z.object({ q: z.string().max(100), lineId: uuid.optional() }).parse(raw); return { ok: true, data: await searchSuppliers(ctx, i.q, i.lineId) }; } catch (e) { return toActionError(e); }
}
const AddPart = z.object({
  lineId: uuid, supplierId: uuid.optional(), contactId: uuid.nullish(), status: z.enum(PARTICIPATION_STATUSES).optional(), notes: optStr,
  create: z.object({ legalName: z.string().trim().min(3).max(200), cnName: optStr, city: optStr, contactName: optStr, channel: z.enum(CONTACT_CHANNELS), handle: optStr, phone: optStr }).optional(),
}).refine((v) => v.supplierId || v.create, { message: "Pick a supplier or create one", path: ["supplierId"] });
export async function addParticipationAction(raw: z.input<typeof AddPart>) { return run(async () => addParticipation(await authorize({ roles: OPS_ROLES }), AddPart.parse(raw))); }
const SetStatus = z.object({ participationId: uuid, status: z.enum(PARTICIPATION_STATUSES), reason: optStr, dontBump: z.boolean().optional() });
export async function setParticipationStatusAction(raw: z.input<typeof SetStatus>) { return run(async () => setParticipationStatus(await authorize({ roles: OPS_ROLES }), SetStatus.parse(raw))); }
const UpdatePart = z.object({ participationId: uuid, notes: optStr, contactId: uuid.nullish(), lastContactAt: z.string().nullish(), dontBump: z.boolean().optional() });
export async function updateParticipationAction(raw: z.input<typeof UpdatePart>) { return run(async () => updateParticipation(await authorize({ roles: OPS_ROLES }), UpdatePart.parse(raw))); }
const Shortlist = z.object({ lineRef: z.string(), participationIds: z.array(uuid).min(1), reason: z.string().trim().min(2).max(500) });
export async function shortlistAction(raw: z.input<typeof Shortlist>) {
  return run(async () => { const ctx = await authorize({ roles: OPS_ROLES }); const i = Shortlist.parse(raw); await shortlistParticipations(ctx, i); return { lineRef: i.lineRef }; });
}
export async function markRfqSentAction(fd: FormData) {
  return run(async () => {
    const ctx = await authorize({ roles: OPS_ROLES });
    const i = z.object({ lineId: uuid, recipientsCount: z.coerce.number().int().nonnegative().max(10_000).optional() }).parse({ lineId: fd.get("lineId"), recipientsCount: fd.get("recipientsCount") || undefined });
    return markRfqSent(ctx, { ...i, file: await fileFrom(fd, "file") });
  });
}
const Break = z.object({ minQty: z.coerce.number().int().positive("Quantity must be at least 1").max(100_000_000), unitPriceMinorE2: z.coerce.number().int().positive("Enter a price above 0").max(MAX_INT) });
const Quote = z.object({
  participationId: uuid, currency: z.enum(["USD", "CNY", "EUR"]), unit: z.enum(UNITS), packQty: optInt, incoterm: z.enum(INCOTERMS).nullish(), incotermUncertain: z.boolean().optional(), port: optStr,
  moq: optInt, leadDays: optInt, leadDaysMax: optInt, validUntil: isoDate.nullish().or(z.literal("").transform(() => null)), paymentTerms: optStr, deviations: optStr, unitWeightG: z.coerce.number().nonnegative().nullish(), carton: optStr, notes: optStr,
  receivedAt: z.string().nullish(), breaks: z.array(Break).min(1, "Add at least one price break (quantity + price)"),
});
export async function logQuoteAction(fd: FormData) {
  return run(async () => {
    const ctx = await authorize({ roles: OPS_ROLES });
    const json = JSON.parse(String(fd.get("json") ?? "{}"));
    const i = Quote.parse(json);
    return logQuote(ctx, { ...i, file: await fileFrom(fd, "file") });
  });
}
export async function previewNormalisationAction(raw: { lineId: string; currency: string; unit: string; packQty?: number | null; breaks: { minQty: number; unitPriceMinorE2: number }[] }) {
  try { const ctx = await authorize({ roles: OPS_ROLES }); return { ok: true as const, data: await previewNormalisation(ctx, raw) }; } catch (e) { return toActionError(e); }
}

/* ───────── offer builder ───────── */
const PriceBreak = z.object({ min_qty: z.coerce.number().int().positive("Quantity must be at least 1").max(100_000_000), unit_price_minor_e2: z.coerce.number().int().positive("Enter a price above 0").max(MAX_INT) });
const Option = z.object({
  label: z.enum(["A", "B", "C"]), participationId: uuid, moq: optInt, leadDays: optInt, priceBreaks: z.array(PriceBreak).min(1, "Add at least one price row"), feeMinor: z.coerce.number().int().nonnegative().max(MAX_INT).default(0), factoryPriceMinorE2: optInt,
  deviationsPlain: z.string().trim().max(2000).default(""), sampleCostMinor: optInt, samplePaidBy: z.enum(SAMPLE_PAID_BY).nullish(), sampleRequired: z.boolean(), paymentTermsClient: optStr, internalNote: optStr,
});
const Offer = z.object({ lineId: uuid, offerId: uuid.nullish(), incoterm: z.enum(INCOTERMS), port: optStr, validUntil: z.string(), noteToClient: optStr, options: z.array(Option).min(1).max(3) });
export async function saveOfferAction(raw: z.input<typeof Offer>, send: boolean) { return run(async () => saveOffer(await authorize({ roles: OPS_ROLES }), Offer.parse(raw), { send })); }

/* ───────── samples ───────── */
const NewSample = z.object({ lineId: uuid, participationId: uuid.nullish(), costMinor: optInt, currency: z.string().default("USD"), paidBy: z.enum(SAMPLE_PAID_BY).nullish(), courier: optStr, tracking: optStr, deviationsVsSpec: optStr });
export async function createSampleAction(raw: z.input<typeof NewSample>) { return run(async () => createSample(await authorize({ roles: OPS_ROLES }), NewSample.parse(raw))); }
const SampleStatus = z.object({ sampleId: uuid, status: z.enum(["shipped", "received"]), courier: optStr, tracking: optStr, deviationsVsSpec: optStr, noteToClient: optStr });
export async function setSampleStatusAction(raw: z.input<typeof SampleStatus>) { return run(async () => setSampleStatus(await authorize({ roles: OPS_ROLES }), SampleStatus.parse(raw))); }
export async function uploadSamplePhotoAction(fd: FormData) {
  return run(async () => {
    const ctx = await authorize({ roles: OPS_ROLES });
    const { sampleId } = z.object({ sampleId: uuid }).parse({ sampleId: fd.get("sampleId") });
    const file = await fileFrom(fd, "file");
    if (!file || !/^image\//.test(file.mime)) throw new z.ZodError([{ code: "custom", path: ["file"], message: "Choose an image", input: null } as never]);
    return uploadSamplePhoto(ctx, { sampleId, ...file });
  });
}
export async function skipSampleAction(raw: { lineId: string; reason: string }) { return run(async () => skipSample(await authorize({ roles: OPS_ROLES }), z.object({ lineId: uuid, reason: z.string().trim().min(5).max(500) }).parse(raw))); }
export async function reSourceAction(raw: { lineId: string; to: "negotiating" | "shortlisted" }) { return run(async () => reSource(await authorize({ roles: OPS_ROLES }), z.object({ lineId: uuid, to: z.enum(["negotiating", "shortlisted"]) }).parse(raw))); }

/* ───────── timeline ───────── */
const Body = z.object({ lineId: uuid, body: z.string().trim().min(1).max(4000) });
export async function addInternalNoteAction(raw: z.input<typeof Body>) { return run(async () => addInternalNote(await authorize({ roles: OPS_ROLES }), Body.parse(raw))); }
export async function askClientAction(raw: z.input<typeof Body>) { return run(async () => askClient(await authorize({ roles: OPS_ROLES }), Body.parse(raw))); }
export async function replyToClientAction(raw: z.input<typeof Body> & { questionId?: string | null }) { return run(async () => replyToClient(await authorize({ roles: OPS_ROLES }), Body.extend({ questionId: uuid.nullish() }).parse(raw))); }
export async function postClientUpdateAction(fd: FormData) {
  return run(async () => {
    const ctx = await authorize({ roles: OPS_ROLES });
    const i = z.object({ lineId: uuid, body: z.string().trim().min(1).max(4000), photoKind: z.enum(["production_photo", "sample_photo"]).default("production_photo") }).parse({ lineId: fd.get("lineId"), body: fd.get("body"), photoKind: fd.get("photoKind") || undefined });
    const photos = (await filesFrom(fd, "photos")).filter((p) => /^image\//.test(p.mime)).slice(0, 5);
    return postClientUpdate(ctx, { ...i, photos });
  });
}
export async function logWhatsAppAction(fd: FormData) {
  return run(async () => {
    const ctx = await authorize({ roles: OPS_ROLES });
    const i = z.object({ lineId: uuid, counterparty: z.string().trim().min(1).max(200), body: z.string().trim().min(1).max(8000), occurredAt: z.string().nullish().or(z.literal("").transform(() => null)) }).parse({ lineId: fd.get("lineId"), counterparty: fd.get("counterparty"), body: fd.get("body"), occurredAt: fd.get("occurredAt") });
    return logWhatsApp(ctx, { ...i, screenshot: await fileFrom(fd, "screenshot") });
  });
}
const Exception = z.object({ lineId: uuid, exception: z.enum(["on_hold", "cancelled"]), reason: z.string().trim().min(3).max(500) });
export async function setExceptionAction(raw: z.input<typeof Exception>) { return run(async () => setLineException(await authorize({ roles: OPS_ROLES }), Exception.parse(raw))); }
export async function clearExceptionAction(raw: { lineId: string }) { return run(async () => clearLineException(await authorize({ roles: OPS_ROLES }), z.object({ lineId: uuid }).parse(raw))); }
export async function resolveChangeRequestAction(raw: { lineId: string; choice: "keep" | "negotiating" | "rfq_out" | "spec" }) { return run(async () => resolveChangeRequest(await authorize({ roles: OPS_ROLES }), z.object({ lineId: uuid, choice: z.enum(["keep", "negotiating", "rfq_out", "spec"]) }).parse(raw))); }
export async function resolveQuestionAction(raw: { lineId: string }) { return run(async () => resolveQuestion(await authorize({ roles: OPS_ROLES }), z.object({ lineId: uuid }).parse(raw))); }
