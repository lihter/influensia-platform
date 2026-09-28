/**
 * Client-visible update (SPEC F-19 "Client update"): leak check on the text and every photo filename, photos published
 * as `production_photo` / `sample_photo` documents (visibility client) together with the comment, outbox `client_new_update`.
 * A blocked publish writes `leak_check_blocked` (internal) + `ops_leak_blocked` to the actor and admins (N-22).
 */
import { uuidv7 } from "uuidv7";
import { getDb } from "@/db";
import { comments } from "@/db/schema/app";
import { type Ctx, isOps, Forbidden } from "@/server/shared/authorize";
import { logActivity } from "@/server/shared/activity";
import { enqueue } from "@/server/shared/outbox";
import { clientUsersOf, opsUsers } from "@/server/shared/users";
import { now } from "@/server/shared/clock";
import { storeDocument } from "@/server/shared/files";
import { leakCheck, loadLeakSources, LeakCheckError } from "@/server/shared/leak-check";
import { lineById } from "./participations";

export type ClientUpdateInput = { lineId: string; body: string; photoKind?: "production_photo" | "sample_photo"; photos?: { data: Buffer; mime: string; filename: string }[] };

export async function postClientUpdate(ctx: Ctx, input: ClientUpdateInput) {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const db = await getDb();
  const at = now();
  const line = await lineById(db, input.lineId);
  const sources = await loadLeakSources(db);
  const check = leakCheck({ text: input.body, filenames: (input.photos ?? []).map((p) => p.filename) }, sources);
  if (!check.ok) {
    await db.transaction(async (tx) => {
      await logActivity(tx, { orgId: line.orgId, entityType: "request_line", entityId: line.id, type: "leak_check_blocked", actorId: ctx.userId, actorName: ctx.name, visibility: "internal", at, payload: { ref: line.lineRef, where: "client update", hits: check.hits } });
      const recipients = (await opsUsers(tx)).filter((u) => u.role === "admin" || u.id === ctx.userId);
      for (const u of recipients) await enqueue({ userId: u.id, toEmail: u.email, template: "ops_leak_blocked", entityRef: line.lineRef, subject: `Publish blocked on ${line.lineRef}: supplier identifier found`, payload: { ref: line.lineRef, hits: check.hits, url: `/ops/lines/${line.lineRef}?tab=timeline` }, idempotencyKey: `ops_leak_blocked:${line.id}:${at.toISOString()}:${u.id}`, at }, tx);
    });
    throw new LeakCheckError(check.hits);
  }
  return db.transaction(async (tx) => {
    const attachments: string[] = [];
    for (const p of input.photos ?? []) {
      const r = await storeDocument(tx, { orgId: line.orgId, userId: ctx.userId, actorName: ctx.name, data: p.data, mime: p.mime, filename: p.filename, entity: "request_line", entityId: line.id, kind: input.photoKind ?? "production_photo", visibility: "client", at, sources });
      attachments.push(r.documentId);
    }
    const id = uuidv7();
    await tx.insert(comments).values({ id, orgId: line.orgId, entityType: "request_line", entityId: line.id, authorId: ctx.userId, authorName: ctx.name, body: input.body.trim(), kind: "update", visibility: "client", source: "app", attachments, createdBy: ctx.userId, createdAt: at, updatedAt: at });
    await logActivity(tx, { orgId: line.orgId, entityType: "request_line", entityId: line.id, type: "comment_posted", actorId: ctx.userId, actorName: ctx.name, visibility: "client", at, payload: { ref: line.lineRef, kind: "update", text: input.body.trim(), photos: attachments.length } });
    for (const u of await clientUsersOf(tx, line.orgId)) await enqueue({ userId: u.id, toEmail: u.email, template: "client_new_update", entityRef: line.lineRef, subject: `Update on ${line.name}`, payload: { ref: line.lineRef, name: line.name, text: input.body.trim(), url: `/app/lines/${line.lineRef}` }, idempotencyKey: `client_new_update:${id}:${u.id}`, at }, tx);
    return { lineRef: line.lineRef, commentId: id, photos: attachments.length };
  });
}
