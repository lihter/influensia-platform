/**
 * "Ask about this order" (SPEC F-07): client comment `question` (or `answer` when the agency asked first), outbox
 * `ops_client_question` to the assigned agent (or all ops), clears `needs_input` when set.
 */
import { and, eq, isNull } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { getDb } from "@/db";
import { requestLines, requests, comments, organizations } from "@/db/schema/app";
import { isBeforeOrder } from "@/server/shared/state-machine";
import { type Ctx, isClient, Forbidden, NotFound } from "@/server/shared/authorize";
import { logActivity } from "@/server/shared/activity";
import { setException } from "@/server/shared/transition";
import { enqueue } from "@/server/shared/outbox";
import { opsUsers } from "@/server/shared/users";
import { now } from "@/server/shared/clock";

export async function askAboutLine(ctx: Ctx, input: { lineRef: string; body: string }) {
  if (!isClient(ctx)) throw new Forbidden("clients only");
  const db = await getDb();
  const at = now();
  return db.transaction(async (tx) => {
    const [line] = await tx.select().from(requestLines).where(and(eq(requestLines.lineRef, input.lineRef), eq(requestLines.orgId, ctx.orgId), isNull(requestLines.deletedAt))).limit(1);
    if (!line) throw new NotFound("line");
    const answering = line.exception === "needs_input";
    const id = uuidv7();
    await tx.insert(comments).values({ id, orgId: line.orgId, entityType: "request_line", entityId: line.id, authorId: ctx.userId, authorName: ctx.name, body: input.body.trim(), kind: answering ? "answer" : "question", visibility: "client", source: "app", createdBy: ctx.userId, createdAt: at, updatedAt: at });
    await logActivity(tx, { orgId: line.orgId, entityType: "request_line", entityId: line.id, type: "comment_posted", actorId: ctx.userId, actorName: ctx.name, visibility: "client", at, payload: { ref: line.lineRef, kind: answering ? "answer" : "question", text: input.body.trim() } });
    if (answering) await setException({ lineId: line.id }, null, ctx, { tx, at });
    const [org] = await tx.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, ctx.orgId)).limit(1);
    const recipients = (await opsUsers(tx)).filter((u) => (line.assignedAgentId ? u.id === line.assignedAgentId : true));
    for (const u of recipients) await enqueue({ userId: u.id, toEmail: u.email, template: "ops_client_question", entityRef: line.lineRef, subject: `Question from ${org?.name ?? "client"} on ${line.lineRef}`, payload: { ref: line.lineRef, name: line.name, text: input.body.trim(), url: `/ops/lines/${line.lineRef}?tab=timeline` }, idempotencyKey: `ops_client_question:${id}:${u.id}`, at }, tx);
    return { lineRef: line.lineRef, commentId: id, answered: answering };
  });
}

/**
 * QA-08 "Request a change" on a frozen line (SPEC AC-REQ-02/03): client comment `change_request` (client-visible),
 * exception `change_requested` (the agent resolves it: keep / reopen sourcing / re-freeze spec), outbox
 * `ops_client_action` to the assigned agent (or every ops user). Allowed once the spec is frozen and before an order.
 */
export async function requestSpecChange(ctx: Ctx, input: { lineRef: string; text: string }) {
  if (!isClient(ctx)) throw new Forbidden("clients only");
  const db = await getDb();
  const at = now();
  return db.transaction(async (tx) => {
    const [line] = await tx.select().from(requestLines).where(and(eq(requestLines.lineRef, input.lineRef), eq(requestLines.orgId, ctx.orgId), isNull(requestLines.deletedAt))).limit(1);
    if (!line) throw new NotFound("line");
    const frozen = !!line.specVersion && !["draft", "submitted", "in_review"].includes(line.state) && isBeforeOrder(line.state as never);
    if (!frozen || line.exception === "cancelled") throw new SpecChangeError("E_NOT_CHANGEABLE");
    const body = input.text.trim();
    const id = uuidv7();
    await tx.insert(comments).values({ id, orgId: line.orgId, entityType: "request_line", entityId: line.id, authorId: ctx.userId, authorName: ctx.name, body, kind: "change_request", visibility: "client", source: "app", createdBy: ctx.userId, createdAt: at, updatedAt: at });
    await logActivity(tx, { orgId: line.orgId, entityType: "request_line", entityId: line.id, type: "comment_posted", actorId: ctx.userId, actorName: ctx.name, visibility: "client", at, payload: { ref: line.lineRef, kind: "change_request", commentId: id, text: "Change requested — we're on it" } });
    await setException({ lineId: line.id }, "change_requested", ctx, { tx, at, reason: body.slice(0, 200) });
    const [org] = await tx.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, ctx.orgId)).limit(1);
    const recipients = (await opsUsers(tx)).filter((u) => (line.assignedAgentId ? u.id === line.assignedAgentId : true));
    for (const u of recipients) await enqueue({ userId: u.id, toEmail: u.email, template: "ops_client_action", entityRef: line.lineRef, subject: `${org?.name ?? "Client"} asked to change the spec of ${line.lineRef}`, payload: { ref: line.lineRef, name: line.name, action: "spec_change_requested", text: body, url: `/ops/lines/${line.lineRef}?tab=timeline` }, idempotencyKey: `ops_client_action:spec_change:${id}:${u.id}`, at }, tx);
    return { lineRef: line.lineRef, commentId: id };
  });
}

export class SpecChangeError extends Error {
  status = 409;
  constructor(public code: "E_NOT_CHANGEABLE") { super(code); }
}

/**
 * QA-08 "Ask about this request" on the request page (F-06): client comment `question` on the request, outbox
 * `ops_client_question` to the agents who own its lines (or every ops user when none is assigned).
 */
export async function askAboutRequest(ctx: Ctx, input: { requestRef: string; body: string }) {
  if (!isClient(ctx)) throw new Forbidden("clients only");
  const db = await getDb();
  const at = now();
  return db.transaction(async (tx) => {
    const [req] = await tx.select().from(requests).where(and(eq(requests.ref, input.requestRef), eq(requests.orgId, ctx.orgId), isNull(requests.deletedAt))).limit(1);
    if (!req) throw new NotFound("request");
    const body = input.body.trim();
    const id = uuidv7();
    await tx.insert(comments).values({ id, orgId: req.orgId, entityType: "request", entityId: req.id, authorId: ctx.userId, authorName: ctx.name, body, kind: "question", visibility: "client", source: "app", createdBy: ctx.userId, createdAt: at, updatedAt: at });
    await logActivity(tx, { orgId: req.orgId, entityType: "request", entityId: req.id, type: "comment_posted", actorId: ctx.userId, actorName: ctx.name, visibility: "client", at, payload: { ref: req.ref, kind: "question", commentId: id, text: body } });
    const agents = new Set((await tx.select({ a: requestLines.assignedAgentId }).from(requestLines).where(and(eq(requestLines.requestId, req.id), isNull(requestLines.deletedAt)))).map((r) => r.a).filter((x): x is string => !!x));
    const [org] = await tx.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, ctx.orgId)).limit(1);
    const all = await opsUsers(tx);
    const recipients = agents.size ? all.filter((u) => agents.has(u.id)) : all;
    for (const u of recipients) await enqueue({ userId: u.id, toEmail: u.email, template: "ops_client_question", entityRef: req.ref, subject: `Question from ${org?.name ?? "client"} on ${req.ref}`, payload: { ref: req.ref, text: body, url: `/ops/requests/${req.ref}` }, idempotencyKey: `ops_client_question:${id}:${u.id}`, at }, tx);
    return { requestRef: req.ref, commentId: id };
  });
}
