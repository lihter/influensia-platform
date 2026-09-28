/**
 * Samples, ops side (SPEC F-20): create (→ sampling when needed), shipped/received with the client emails, photos
 * (published on upload, filename leak-checked), skip sample, re-source after a rejection.
 */
import { ZodError } from "zod";
import { and, eq, isNull, sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { getDb } from "@/db";
import { samples, payments } from "@/db/schema/app";
import type { SamplePaidBy } from "@/db/enums";
import { type Ctx, isOps, Forbidden, NotFound } from "@/server/shared/authorize";
import { logActivity } from "@/server/shared/activity";
import { transition, setException } from "@/server/shared/transition";
import { enqueue } from "@/server/shared/outbox";
import { clientUsersOf } from "@/server/shared/users";
import { now } from "@/server/shared/clock";
import { sampleRef } from "@/server/shared/ids";
import { storeDocument } from "@/server/shared/files";
import { loadLeakSources } from "@/server/shared/leak-check";
import { lineById } from "./participations";

export type CreateSampleInput = { lineId: string; participationId?: string | null; costMinor?: number | null; currency?: string; paidBy?: SamplePaidBy | null; courier?: string | null; tracking?: string | null; deviationsVsSpec?: string | null };

export async function createSample(ctx: Ctx, input: CreateSampleInput) {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const db = await getDb();
  const at = now();
  return db.transaction(async (tx) => {
    const line = await lineById(tx, input.lineId);
    const [cnt] = await tx.select({ n: sql<number>`count(*)` }).from(samples).where(eq(samples.requestLineId, line.id));
    const n = Number(cnt?.n ?? 0) + 1;
    const id = uuidv7();
    const ref = sampleRef(line.lineRef, n);
    const participationId = input.participationId ?? line.selectedParticipationId ?? null;
    await tx.insert(samples).values({ id, ref, orgId: line.orgId, requestLineId: line.id, participationId: participationId as never, status: "ordered", costMinor: input.costMinor ?? null, currency: input.currency ?? "USD", paidBy: input.paidBy ?? null, courier: input.courier ?? null, tracking: input.tracking ?? null, orderedAt: at, deviationsVsSpec: input.deviationsVsSpec ?? null, createdBy: ctx.userId, createdAt: at, updatedAt: at });
    if (input.paidBy === "client" && input.costMinor && input.costMinor > 0) {
      await tx.insert(payments).values({ id: uuidv7(), orgId: line.orgId, requestLineId: line.id, kind: "sample", amountMinor: input.costMinor, currency: input.currency ?? "USD", payee: "agency", status: "pending", createdBy: ctx.userId, createdAt: at, updatedAt: at });
    }
    await logActivity(tx, { orgId: line.orgId, entityType: "request_line", entityId: line.id, type: "sample_created", actorId: ctx.userId, actorName: ctx.name, visibility: "client", at, payload: { ref: line.lineRef, sampleRef: ref, text: "Sample ordered" } });
    if (line.state === "offer_accepted" || line.state === "offer_ready") await transition(line.id, "sampling", ctx, { tx, at });
    else if (line.state === "sampling" && line.exception === "sample_rejected") await setException({ lineId: line.id }, null, ctx, { tx, at });
    return { sampleId: id, sampleRef: ref, lineRef: line.lineRef };
  });
}

export async function setSampleStatus(ctx: Ctx, input: { sampleId: string; status: "shipped" | "received"; courier?: string | null; tracking?: string | null; deviationsVsSpec?: string | null; noteToClient?: string | null }) {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const db = await getDb();
  const at = now();
  return db.transaction(async (tx) => {
    const [s] = await tx.select().from(samples).where(eq(samples.id, input.sampleId)).for("update");
    if (!s || s.deletedAt || !s.requestLineId) throw new NotFound("sample");
    const line = await lineById(tx, s.requestLineId);
    if (input.status === "shipped" && !(input.tracking ?? s.tracking)) { throw new ZodError([{ code: "custom", path: ["tracking"], message: "Tracking required to mark shipped", input: null } as never]); }
    const courier = input.courier ?? s.courier; const tracking = input.tracking ?? s.tracking;
    await tx.update(samples).set({ status: input.status, courier, tracking, ...(input.status === "shipped" ? { shippedAt: at } : { receivedAt: at }), ...(input.deviationsVsSpec !== undefined ? { deviationsVsSpec: input.deviationsVsSpec } : {}), updatedAt: at }).where(eq(samples.id, s.id));
    const text = input.status === "shipped" ? `Sample shipped${courier ? ` — ${courier} ${tracking ?? ""}`.trimEnd() : ""}` : "Sample received";
    await logActivity(tx, { orgId: line.orgId, entityType: "request_line", entityId: line.id, type: "sample_status_changed", actorId: ctx.userId, actorName: ctx.name, visibility: "client", at, payload: { ref: line.lineRef, sampleRef: s.ref, status: input.status, courier, tracking, text } });
    if (input.noteToClient?.trim()) {
      const { assertClean } = await import("@/server/shared/leak-check");
      assertClean({ text: input.noteToClient }, await loadLeakSources(tx));
      const { comments } = await import("@/db/schema/app");
      await tx.insert(comments).values({ id: uuidv7(), orgId: line.orgId, entityType: "request_line", entityId: line.id, authorId: ctx.userId, authorName: ctx.name, body: input.noteToClient.trim(), kind: "update", visibility: "client", source: "app", createdBy: ctx.userId, createdAt: at, updatedAt: at });
    }
    for (const u of await clientUsersOf(tx, line.orgId)) {
      if (input.status === "shipped") await enqueue({ userId: u.id, toEmail: u.email, template: "client_sample_shipped", entityRef: s.ref, subject: `Your sample is on its way — ${line.name}`, payload: { ref: s.ref, lineRef: line.lineRef, name: line.name, courier, tracking, url: `/app/samples/${s.ref}` }, idempotencyKey: `client_sample_shipped:${s.id}:${u.id}`, at }, tx);
      else await enqueue({ userId: u.id, toEmail: u.email, template: "client_sample_ready", entityRef: s.ref, subject: "Sample received — please approve or reject", payload: { ref: s.ref, lineRef: line.lineRef, name: line.name, url: `/app/samples/${s.ref}` }, idempotencyKey: `client_sample_ready:${s.id}:${u.id}`, at }, tx);
    }
    return { lineRef: line.lineRef, sampleRef: s.ref };
  });
}

/** Agent photo of the sample: `sample_photo`, visibility client, filename leak-checked (SPEC F-20). */
export async function uploadSamplePhoto(ctx: Ctx, input: { sampleId: string; data: Buffer; mime: string; filename: string }) {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const db = await getDb();
  const at = now();
  return db.transaction(async (tx) => {
    const [s] = await tx.select().from(samples).where(eq(samples.id, input.sampleId)).limit(1);
    if (!s || s.deletedAt || !s.requestLineId) throw new NotFound("sample");
    const line = await lineById(tx, s.requestLineId);
    const sources = await loadLeakSources(tx);
    await storeDocument(tx, { orgId: line.orgId, userId: ctx.userId, actorName: ctx.name, data: input.data, mime: input.mime, filename: input.filename, entity: "sample", entityId: s.id, kind: "sample_photo", visibility: "client", at, sources });
    return { lineRef: line.lineRef, sampleRef: s.ref };
  });
}

/** "Skip sample": sampling → offer_accepted; no sample may be received/approved; reason ≥ 5 chars. */
export async function skipSample(ctx: Ctx, input: { lineId: string; reason: string }) {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  if (input.reason.trim().length < 5) { throw new ZodError([{ code: "custom", path: ["reason"], message: "Reason ≥ 5 characters", input: input.reason } as never]); }
  const db = await getDb();
  const at = now();
  return db.transaction(async (tx) => {
    const line = await lineById(tx, input.lineId);
    const rows = await tx.select({ status: samples.status }).from(samples).where(and(eq(samples.requestLineId, line.id), isNull(samples.deletedAt)));
    if (rows.some((r) => r.status === "received" || r.status === "approved")) { throw new ZodError([{ code: "custom", path: ["_"], message: "A sample is already received — decide it instead", input: null } as never]); }
    await transition(line.id, "offer_accepted", ctx, { tx, at, note: undefined, payload: { sampleSkipped: true, reason: input.reason }, clearException: true });
    return { lineRef: line.lineRef };
  });
}

/** "Re-source" after a rejected sample: sampling → negotiating | shortlisted, exception cleared. */
export async function reSource(ctx: Ctx, input: { lineId: string; to: "negotiating" | "shortlisted" }) {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const db = await getDb();
  const line = await lineById(db, input.lineId);
  await transition(line.id, input.to, ctx, { clearException: true });
  return { lineRef: line.lineRef };
}
