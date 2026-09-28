/**
 * Client sample page (SPEC F-09): status timeline, photos, approve / reject (reason ≥ 10 chars, up to 5 photos).
 */
import { ZodError } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { getDb, type DbOrTx } from "@/db";
import { requestLines, samples, comments, organizations } from "@/db/schema/app";
import { type Ctx, isClient, Forbidden, NotFound } from "@/server/shared/authorize";
import { logActivity } from "@/server/shared/activity";
import { transition, setException } from "@/server/shared/transition";
import { enqueue } from "@/server/shared/outbox";
import { opsUsers } from "@/server/shared/users";
import { now } from "@/server/shared/clock";
import { storeDocument } from "@/server/shared/files";
import { ClientSampleDto } from "./dto";
import { clientDocuments } from "./lines";

async function sampleByRef(db: DbOrTx, ctx: Ctx, ref: string) {
  const [s] = await db.select().from(samples).where(and(eq(samples.ref, ref), eq(samples.orgId, ctx.orgId), isNull(samples.deletedAt))).limit(1);
  if (!s || !s.requestLineId) throw new NotFound("sample");
  const [line] = await db.select().from(requestLines).where(and(eq(requestLines.id, s.requestLineId), eq(requestLines.orgId, ctx.orgId))).limit(1);
  if (!line) throw new NotFound("sample");
  return { s, line };
}

export async function getClientSample(ctx: Ctx, ref: string) {
  if (!isClient(ctx)) throw new Forbidden("clients only");
  const db = await getDb();
  const { s, line } = await sampleByRef(db, ctx, ref);
  const photos = await clientDocuments(db, ctx.orgId, [{ entityType: "sample", entityId: s.id }]);
  return ClientSampleDto.parse({
    id: s.id, ref: s.ref, lineRef: line.lineRef, lineName: line.name, status: s.status,
    cost: s.costMinor !== null ? { minor: s.costMinor, currency: s.currency } : null, paidBy: s.paidBy, courier: s.courier, tracking: s.tracking,
    orderedAt: s.orderedAt?.toISOString() ?? null, shippedAt: s.shippedAt?.toISOString() ?? null, receivedAt: s.receivedAt?.toISOString() ?? null, decidedAt: s.decidedAt?.toISOString() ?? null,
    rejectReason: s.rejectReason, photos: photos.filter((p) => p.kind === "sample_photo"), canDecide: s.status === "received",
  });
}

async function notifyAgent(tx: DbOrTx, line: typeof requestLines.$inferSelect, action: string, entityRef: string, at: Date, orgId: string) {
  const [org] = await tx.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, orgId)).limit(1);
  const recipients = (await opsUsers(tx)).filter((u) => (line.assignedAgentId ? u.id === line.assignedAgentId : true));
  for (const u of recipients) await enqueue({ userId: u.id, toEmail: u.email, template: "ops_client_action", entityRef, subject: `${org?.name ?? "Client"}: ${action} on ${entityRef}`, payload: { ref: entityRef, lineRef: line.lineRef, action, url: `/ops/lines/${line.lineRef}?tab=timeline` }, idempotencyKey: `ops_client_action:${entityRef}:${action}:${at.toISOString()}:${u.id}`, at }, tx);
}

export async function approveSample(ctx: Ctx, input: { ref: string; note?: string | null }) {
  if (!isClient(ctx)) throw new Forbidden("clients only");
  const db = await getDb();
  const at = now();
  return db.transaction(async (tx) => {
    const { s, line } = await sampleByRef(tx, ctx, input.ref);
    if (s.status !== "received") throw new Forbidden("sample not received");
    await tx.update(samples).set({ status: "approved", approvedBy: ctx.userId, approvedAt: at, decidedAt: at, decidedBy: ctx.userId, updatedAt: at }).where(eq(samples.id, s.id));
    await logActivity(tx, { orgId: line.orgId, entityType: "request_line", entityId: line.id, type: "sample_decided", actorId: ctx.userId, actorName: ctx.name, visibility: "client", at, payload: { ref: line.lineRef, sampleRef: s.ref, decision: "approved", text: "Sample approved" } });
    if (input.note?.trim()) await tx.insert(comments).values({ id: uuidv7(), orgId: line.orgId, entityType: "request_line", entityId: line.id, authorId: ctx.userId, authorName: ctx.name, body: input.note.trim(), kind: "update", visibility: "client", source: "app", createdBy: ctx.userId, createdAt: at, updatedAt: at });
    if (line.state === "sampling") await transition(line.id, "offer_accepted", ctx, { tx, at, clearException: true });
    await notifyAgent(tx, line, "approved the sample", s.ref, at, ctx.orgId);
    return { lineRef: line.lineRef };
  });
}

export async function rejectSample(ctx: Ctx, input: { ref: string; reason: string; photos?: { data: Buffer; mime: string; filename: string }[] }) {
  if (!isClient(ctx)) throw new Forbidden("clients only");
  if (input.reason.trim().length < 10) { throw new ZodError([{ code: "custom", path: ["reason"], message: "Reason must be at least 10 characters", input: input.reason } as never]); }
  const db = await getDb();
  const at = now();
  return db.transaction(async (tx) => {
    const { s, line } = await sampleByRef(tx, ctx, input.ref);
    if (s.status !== "received") throw new Forbidden("sample not received");
    const attachments: string[] = [];
    for (const p of (input.photos ?? []).slice(0, 5)) {
      const r = await storeDocument(tx, { orgId: line.orgId, userId: ctx.userId, actorName: ctx.name, data: p.data, mime: p.mime, filename: p.filename, entity: "sample", entityId: s.id, kind: "sample_photo", visibility: "client", at });
      attachments.push(r.documentId);
    }
    await tx.update(samples).set({ status: "rejected", rejectReason: input.reason.trim(), decidedAt: at, decidedBy: ctx.userId, updatedAt: at }).where(eq(samples.id, s.id));
    await tx.insert(comments).values({ id: uuidv7(), orgId: line.orgId, entityType: "request_line", entityId: line.id, authorId: ctx.userId, authorName: ctx.name, body: input.reason.trim(), kind: "reject_reason", visibility: "client", source: "app", attachments, createdBy: ctx.userId, createdAt: at, updatedAt: at });
    await logActivity(tx, { orgId: line.orgId, entityType: "request_line", entityId: line.id, type: "sample_decided", actorId: ctx.userId, actorName: ctx.name, visibility: "client", at, payload: { ref: line.lineRef, sampleRef: s.ref, decision: "rejected", text: "Sample rejected" } });
    await setException({ lineId: line.id }, "sample_rejected", ctx, { tx, at, reason: input.reason.trim().slice(0, 200) });
    await notifyAgent(tx, line, "rejected the sample", s.ref, at, ctx.orgId);
    return { lineRef: line.lineRef, photos: attachments.length };
  });
}
