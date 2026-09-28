/**
 * Timeline composer, ops side (SPEC F-19): internal notes, Log WhatsApp (never notifies anyone, never serialises to
 * clients), Ask the client (needs_input), Reply / Resolve, and the exception controls (on hold / cancel / clear /
 * resolve change request). Client updates live in ./publish.ts because they run the leak check + photo publish.
 */
import { ZodError } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { getDb } from "@/db";
import { comments, requestLines } from "@/db/schema/app";
import type { LineException } from "@/db/enums";
import { type Ctx, isOps, Forbidden, NotFound } from "@/server/shared/authorize";
import { logActivity } from "@/server/shared/activity";
import { transition, setException } from "@/server/shared/transition";
import { enqueue } from "@/server/shared/outbox";
import { clientUsersOf } from "@/server/shared/users";
import { now } from "@/server/shared/clock";
import { storeDocument } from "@/server/shared/files";
import { assertClean, loadLeakSources } from "@/server/shared/leak-check";
import { lineById } from "./participations";

export async function addInternalNote(ctx: Ctx, input: { lineId: string; body: string }) {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const db = await getDb();
  const at = now();
  return db.transaction(async (tx) => {
    const line = await lineById(tx, input.lineId);
    const id = uuidv7();
    await tx.insert(comments).values({ id, orgId: line.orgId, entityType: "request_line", entityId: line.id, authorId: ctx.userId, authorName: ctx.name, body: input.body.trim(), kind: "note", visibility: "internal", source: "app", createdBy: ctx.userId, createdAt: at, updatedAt: at });
    await logActivity(tx, { orgId: line.orgId, entityType: "request_line", entityId: line.id, type: "comment_posted", actorId: ctx.userId, actorName: ctx.name, visibility: "internal", at, payload: { ref: line.lineRef, commentId: id, kind: "note" } });
    return { lineRef: line.lineRef, commentId: id };
  });
}

export async function logWhatsApp(ctx: Ctx, input: { lineId: string; counterparty: string; body: string; occurredAt?: string | null; screenshot?: { data: Buffer; mime: string; filename: string } | null }) {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const db = await getDb();
  const at = now();
  return db.transaction(async (tx) => {
    const line = await lineById(tx, input.lineId);
    const attachments: string[] = [];
    if (input.screenshot) {
      const r = await storeDocument(tx, { orgId: line.orgId, userId: ctx.userId, actorName: ctx.name, data: input.screenshot.data, mime: input.screenshot.mime, filename: input.screenshot.filename, entity: "request_line", entityId: line.id, kind: "other", visibility: "internal", at });
      attachments.push(r.documentId);
    }
    const id = uuidv7();
    await tx.insert(comments).values({ id, orgId: line.orgId, entityType: "request_line", entityId: line.id, authorId: ctx.userId, authorName: ctx.name, body: input.body.trim(), kind: "note", visibility: "internal", source: "whatsapp_log", counterparty: input.counterparty.trim(), occurredAt: input.occurredAt ? new Date(input.occurredAt) : at, attachments, createdBy: ctx.userId, createdAt: at, updatedAt: at });
    await logActivity(tx, { orgId: line.orgId, entityType: "request_line", entityId: line.id, type: "whatsapp_logged", actorId: ctx.userId, actorName: ctx.name, visibility: "internal", at, payload: { ref: line.lineRef, commentId: id, counterparty: input.counterparty } });
    return { lineRef: line.lineRef, commentId: id };
  });
}

/** "Ask the client": client-visible question, exception needs_input, outbox client_input_needed (N-17). */
export async function askClient(ctx: Ctx, input: { lineId: string; body: string }) {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const db = await getDb();
  const at = now();
  return db.transaction(async (tx) => {
    const line = await lineById(tx, input.lineId);
    assertClean({ text: input.body }, await loadLeakSources(tx));
    const id = uuidv7();
    await tx.insert(comments).values({ id, orgId: line.orgId, entityType: "request_line", entityId: line.id, authorId: ctx.userId, authorName: ctx.name, body: input.body.trim(), kind: "question", visibility: "client", source: "app", createdBy: ctx.userId, createdAt: at, updatedAt: at });
    await logActivity(tx, { orgId: line.orgId, entityType: "request_line", entityId: line.id, type: "comment_posted", actorId: ctx.userId, actorName: ctx.name, visibility: "client", at, payload: { ref: line.lineRef, kind: "question", text: `Question: ${input.body.trim()}` } });
    await setException({ lineId: line.id }, "needs_input", ctx, { tx, at, reason: input.body.trim().slice(0, 200) });
    for (const u of await clientUsersOf(tx, line.orgId)) await enqueue({ userId: u.id, toEmail: u.email, template: "client_input_needed", entityRef: line.lineRef, subject: `We need your input — ${line.name}`, payload: { ref: line.lineRef, name: line.name, question: input.body.trim(), url: `/app/lines/${line.lineRef}#ask` }, idempotencyKey: `client_input_needed:${id}:${u.id}`, at }, tx);
    return { lineRef: line.lineRef, commentId: id };
  });
}

/** Reply to a client question: client-visible `answer`; clears needs_input if set; outbox client_new_update. */
export async function replyToClient(ctx: Ctx, input: { lineId: string; body: string; questionId?: string | null }) {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const db = await getDb();
  const at = now();
  return db.transaction(async (tx) => {
    const line = await lineById(tx, input.lineId);
    assertClean({ text: input.body }, await loadLeakSources(tx));
    const id = uuidv7();
    await tx.insert(comments).values({ id, orgId: line.orgId, entityType: "request_line", entityId: line.id, authorId: ctx.userId, authorName: ctx.name, body: input.body.trim(), kind: "answer", visibility: "client", source: "app", createdBy: ctx.userId, createdAt: at, updatedAt: at });
    await logActivity(tx, { orgId: line.orgId, entityType: "request_line", entityId: line.id, type: "comment_posted", actorId: ctx.userId, actorName: ctx.name, visibility: "client", at, payload: { ref: line.lineRef, kind: "answer", text: input.body.trim() } });
    if (line.exception === "needs_input") await setException({ lineId: line.id }, null, ctx, { tx, at });
    for (const u of await clientUsersOf(tx, line.orgId)) await enqueue({ userId: u.id, toEmail: u.email, template: "client_new_update", entityRef: line.lineRef, subject: `Update on ${line.name}`, payload: { ref: line.lineRef, name: line.name, text: input.body.trim(), url: `/app/lines/${line.lineRef}` }, idempotencyKey: `client_new_update:${id}:${u.id}`, at }, tx);
    return { lineRef: line.lineRef, commentId: id };
  });
}

/** Set an exception: on_hold (reason leak-checked, client-visible) or cancelled (reason). */
export async function setLineException(ctx: Ctx, input: { lineId: string; exception: "on_hold" | "cancelled"; reason: string }) {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  if (input.reason.trim().length < 3) { throw new ZodError([{ code: "custom", path: ["reason"], message: "Reason required", input: input.reason } as never]); }
  const db = await getDb();
  const at = now();
  return db.transaction(async (tx) => {
    const line = await lineById(tx, input.lineId);
    if (input.exception === "on_hold") assertClean({ text: input.reason }, await loadLeakSources(tx));
    await setException({ lineId: line.id }, input.exception, ctx, { tx, at, reason: input.reason.trim() });
    if (input.exception === "cancelled") await tx.update(requestLines).set({ cancelReason: input.reason.trim(), updatedAt: at }).where(eq(requestLines.id, line.id));
    return { lineRef: line.lineRef };
  });
}

export async function clearLineException(ctx: Ctx, input: { lineId: string }) {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const db = await getDb();
  const line = await lineById(db, input.lineId);
  if (line.exception === "cancelled") throw new Forbidden("cancelled is terminal");
  await setException({ lineId: line.id }, null, ctx);
  return { lineRef: line.lineRef };
}

/** "Resolve change request" (SPEC 3.5): keep state / reopen negotiating / reopen rfq_out / re-freeze spec (→ spec tab). */
export async function resolveChangeRequest(ctx: Ctx, input: { lineId: string; choice: "keep" | "negotiating" | "rfq_out" | "spec" }) {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const db = await getDb();
  const at = now();
  const line = await lineById(db, input.lineId);
  if (input.choice === "keep" || input.choice === "spec") { await setException({ lineId: line.id }, null, ctx, { at }); return { lineRef: line.lineRef, tab: input.choice === "spec" ? "spec" : "timeline" }; }
  if (line.state === "offer_ready") await transition(line.id, input.choice, ctx, { at, clearException: true });
  else await setException({ lineId: line.id }, null, ctx, { at });
  return { lineRef: line.lineRef, tab: "sourcing" };
}

/** "Resolve" on a client question without a reply (clears needs_input only). */
export async function resolveQuestion(ctx: Ctx, input: { lineId: string }) {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const db = await getDb();
  const line = await lineById(db, input.lineId);
  if (line.exception !== ("needs_input" as LineException)) throw new NotFound("no open question");
  await setException({ lineId: line.id }, null, ctx);
  return { lineRef: line.lineRef };
}

export async function lineIdByRef(ref: string) {
  const db = await getDb();
  const [row] = await db.select({ id: requestLines.id }).from(requestLines).where(and(eq(requestLines.lineRef, ref), isNull(requestLines.deletedAt))).limit(1);
  if (!row) throw new NotFound("line");
  return row.id;
}
