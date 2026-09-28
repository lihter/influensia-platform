/**
 * "Ask about this order" (SPEC F-07): client comment `question` (or `answer` when the agency asked first), outbox
 * `ops_client_question` to the assigned agent (or all ops), clears `needs_input` when set.
 */
import { and, eq, isNull } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { getDb } from "@/db";
import { requestLines, comments, organizations } from "@/db/schema/app";
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
