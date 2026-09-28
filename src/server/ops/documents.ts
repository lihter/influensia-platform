/**
 * Documents (SPEC F-23): internal-by-default upload, publish to client (leak check on filename + text layer, copy to the
 * `/client/` key prefix, flip visibility), unpublish. Ops only. Every mutation logs activity inside its transaction.
 */
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { getDb, type DbOrTx, type Tx } from "@/db";
import { documents, files, orders, users } from "@/db/schema/app";
import { INTERNAL_ONLY_DOCUMENT_KINDS, type DocumentKind, type EntityType, type Visibility } from "@/db/enums";
import type { LeakCheckStored } from "@/db/types";
import { type Ctx, isOps, Forbidden, NotFound } from "@/server/shared/authorize";
import { logActivity } from "@/server/shared/activity";
import { enqueue } from "@/server/shared/outbox";
import { storeDocument, isPublishableKind } from "@/server/shared/files";
import { getStorage, withVisibility } from "@/server/shared/storage";
import { leakCheck, loadLeakSources, LeakCheckError, type LeakSources, type LeakHit } from "@/server/shared/leak-check";
import { clientUsersOf, opsUsers } from "@/server/shared/users";
import { now } from "@/server/shared/clock";
import en from "../../../messages/en.json";

export const documentKindLabel = (k: DocumentKind) => (en.document_kind as Record<string, string>)[k] ?? k;

export class KindNotPublishable extends Error {
  code = "E_KIND_NOT_PUBLISHABLE" as const;
  status = 422;
  constructor(kind: string) { super(`E_KIND_NOT_PUBLISHABLE ${kind}`); }
}

export type OpsDocumentRow = {
  id: string;
  entityType: EntityType;
  entityId: string;
  /** what the document hangs off, for the ops list ("order", "line REQ-…-01", "sample …") */
  entityLabel: string;
  filename: string;
  kind: DocumentKind;
  visibility: Visibility;
  bytes: number;
  mime: string;
  uploadedByName: string | null;
  uploadedAt: string;
  publishedAt: string | null;
  publishedByName: string | null;
  downloadUrl: string;
  publishable: boolean;
  leakCheck: LeakCheckStored | null;
};

/* ────────── text extraction (stub, SPEC F-23 "pdf-parse" is a hosted concern) ────────── */

const TEXT_MIME = /^(text\/|application\/(json|xml|csv))/;
const TEXT_EXT = /\.(txt|md|csv|json|xml|html?)$/i;

/**
 * Extracts a text layer good enough for the leak check:
 *  - text-like files: the whole body
 *  - PDF: literal strings inside uncompressed content streams (`(…) Tj` / `[(…)] TJ`) — covers the seed's one-page
 *    placeholder PDFs; compressed streams are skipped (binary)
 *  - everything else (images, xlsx, docx): nothing — the filename is still checked
 */
export function extractText(data: Buffer, mime: string, filename: string): string {
  if (TEXT_MIME.test(mime) || TEXT_EXT.test(filename)) return data.toString("utf8").slice(0, 200_000);
  if (mime === "application/pdf" || /\.pdf$/i.test(filename)) {
    const raw = data.toString("latin1");
    const parts: string[] = [];
    for (const m of raw.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)) parts.push(unescapePdf(m[1]));
    for (const m of raw.matchAll(/\[((?:\((?:\\.|[^\\)])*\)|[^\]])*)\]\s*TJ/g)) for (const s of m[1].matchAll(/\(((?:\\.|[^\\)])*)\)/g)) parts.push(unescapePdf(s[1]));
    return parts.join(" ");
  }
  return "";
}

const unescapePdf = (s: string) => s.replace(/\\([nrtbf()\\]|\d{1,3})/g, (_, c: string) => (c === "n" ? "\n" : c === "r" ? "\r" : c === "t" ? "\t" : /^\d/.test(c) ? String.fromCharCode(parseInt(c, 8)) : c));

/** The publish gate, as a pure function over a filename + extracted text (unit-tested). */
export function publishLeakCheck(p: { filename: string; text: string }, sources: LeakSources) {
  return leakCheck({ filenames: [p.filename], pdfText: p.text || null }, sources);
}

/* ────────── reads ────────── */

async function nameOf(db: DbOrTx, ids: (string | null)[]) {
  const clean = [...new Set(ids.filter((x): x is string => !!x))];
  if (!clean.length) return {} as Record<string, string>;
  const rows = await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, clean));
  return Object.fromEntries(rows.map((r) => [r.id, r.name]));
}

/** Union of documents attached to any of the given (entityType, entityId) pairs, newest first. */
export async function listDocumentsFor(db: DbOrTx, targets: { entityType: EntityType; entityId: string; label: string }[]): Promise<OpsDocumentRow[]> {
  if (!targets.length) return [];
  const ids = targets.map((t) => t.entityId);
  const rows = await db
    .select({ d: documents, f: files })
    .from(documents)
    .innerJoin(files, eq(files.id, documents.fileId))
    .where(and(inArray(documents.entityId, ids), isNull(documents.deletedAt)))
    .orderBy(desc(documents.createdAt));
  const names = await nameOf(db, rows.flatMap((r) => [r.d.uploadedBy, r.d.publishedBy]));
  const labelOf = new Map(targets.map((t) => [`${t.entityType}:${t.entityId}`, t.label]));
  const storage = getStorage();
  const out: OpsDocumentRow[] = [];
  for (const { d, f } of rows) {
    const label = labelOf.get(`${d.entityType}:${d.entityId}`);
    if (!label) continue;
    out.push({
      id: d.id, entityType: d.entityType, entityId: d.entityId, entityLabel: label, filename: d.filename, kind: d.kind, visibility: d.visibility,
      bytes: f.bytes, mime: f.mime, uploadedByName: d.uploadedBy ? names[d.uploadedBy] ?? null : null, uploadedAt: d.createdAt.toISOString(),
      publishedAt: d.publishedAt?.toISOString() ?? null, publishedByName: d.publishedBy ? names[d.publishedBy] ?? null : null,
      downloadUrl: await storage.downloadUrl(f.storageKey, { filename: d.filename }), publishable: isPublishableKind(d.kind), leakCheck: d.leakCheckResult ?? null,
    });
  }
  return out;
}

/* ────────── writes ────────── */

export type UploadInput = { entityType: EntityType; entityId: string; orgId: string; kind: DocumentKind; filename: string; mime: string; data: Buffer; visibility?: Visibility };

/** Ops upload: internal by default (F-23). Returns the document id. */
export async function uploadDocument(ctx: Ctx, p: UploadInput, tx?: Tx): Promise<{ documentId: string; fileId: string }> {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const run = async (t: DbOrTx) => {
    const r = await storeDocument(t, { orgId: p.orgId, userId: ctx.userId, actorName: ctx.name, data: p.data, mime: p.mime, filename: p.filename, entity: p.entityType, entityId: p.entityId, kind: p.kind, visibility: p.visibility ?? "internal" });
    return { documentId: r.documentId, fileId: r.file.id };
  };
  if (tx) return run(tx);
  const db = await getDb();
  return db.transaction(run as never) as Promise<{ documentId: string; fileId: string }>;
}

async function loadDoc(db: DbOrTx, id: string) {
  const [row] = await db.select({ d: documents, f: files }).from(documents).innerJoin(files, eq(files.id, documents.fileId)).where(and(eq(documents.id, id), isNull(documents.deletedAt))).limit(1);
  if (!row) throw new NotFound("document");
  return row;
}

/**
 * Publish to client (F-23): kind must be publishable; leak check on filename + text layer; on pass the object is copied to the
 * `/client/` key, visibility flips, `document_published` (client-visible) is logged and `client_document_published` is queued
 * unless the kind is covered by a state email (pi → payment due, qc_report → qc result). On a hit: `leak_check_blocked`
 * (internal) + `ops_leak_blocked` to the actor and admins, then LeakCheckError (422) so the dialog can list the matches.
 */
export async function publishDocument(ctx: Ctx, documentId: string, opts: { tx?: Tx; notifyClient?: boolean } = {}) {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const db = await getDb();
  const run = async (tx: DbOrTx) => {
    const { d, f } = await loadDoc(tx, documentId);
    if (!isPublishableKind(d.kind) || INTERNAL_ONLY_DOCUMENT_KINDS.includes(d.kind)) throw new KindNotPublishable(d.kind);
    if (d.visibility === "client") return { documentId, alreadyPublished: true as const, blocked: null };
    const at = now();
    const sources = await loadLeakSources(tx);
    const storage = getStorage();
    let text = "";
    const obj = await storage.get(f.storageKey);
    if (obj) text = extractText(Buffer.from(await new Response(obj.body as ReadableStream).arrayBuffer()), f.mime, d.filename);
    const r = publishLeakCheck({ filename: d.filename, text }, sources);
    const stored = { ok: r.ok, at: at.toISOString(), hits: r.ok ? [] : r.hits.map((h) => ({ kind: h.kind, match: h.match, where: h.where })) };
    if (!r.ok) {
      await recordBlockedPublish(tx, ctx, d, stored, at);
      return { documentId, alreadyPublished: false as const, blocked: r.hits };
    }
    const clientKey = withVisibility(f.storageKey, "client");
    await storage.copy(f.storageKey, clientKey);
    await tx.update(files).set({ storageKey: clientKey }).where(eq(files.id, f.id));
    await tx.update(documents).set({ visibility: "client", publishedAt: at, publishedBy: ctx.userId, leakCheckResult: stored, updatedAt: at }).where(eq(documents.id, documentId));
    const kindLabel = documentKindLabel(d.kind);
    await logActivity(tx, { orgId: d.orgId, entityType: d.entityType, entityId: d.entityId, type: "document_published", actorId: ctx.userId, actorName: ctx.name, visibility: "client", at, payload: { documentId, filename: d.filename, kind: d.kind, kindLabel, text: `New document: ${kindLabel}` } });
    const covered = d.kind === "pi" || d.kind === "qc_report";
    if (opts.notifyClient !== false && !covered) {
      const entityRef = await refFor(tx, d.entityType, d.entityId);
      const url = d.entityType === "order" ? `/app/orders/${entityRef}#documents` : d.entityType === "request_line" ? `/app/lines/${entityRef}` : "/app";
      for (const u of await clientUsersOf(tx, d.orgId)) {
        await enqueue({ userId: u.id, toEmail: u.email, template: "client_document_published", entityRef, subject: `New document: ${kindLabel} for ${entityRef}`, payload: { ref: entityRef, kind: d.kind, kindLabel, filename: d.filename, url }, idempotencyKey: `client_document_published:${documentId}:${u.id}`, at }, tx);
      }
    }
    // keep the internal original around? No — the client copy is the object now; delete the internal one so no stale key lingers.
    await storage.delete(f.storageKey);
    return { documentId, alreadyPublished: false as const, blocked: null };
  };
  // A blocked publish must keep its `leak_check_blocked` event + ops_leak_blocked row, so the transaction commits first
  // and the LeakCheckError is thrown afterwards. With a caller-supplied tx the caller throws after its own commit
  // (see `throwIfBlocked`).
  if (opts.tx) return run(opts.tx);
  const r = (await db.transaction(run as never)) as Awaited<ReturnType<typeof run>>;
  throwIfBlocked(r);
  return r;
}

export type PublishResult = { documentId: string; alreadyPublished: boolean; blocked: LeakHit[] | null };
export function throwIfBlocked(r: PublishResult) { if (r.blocked) throw new LeakCheckError(r.blocked); }

/** Unpublish: visibility back to internal, client copy removed, `document_unpublished` (internal). */
export async function unpublishDocument(ctx: Ctx, documentId: string) {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const db = await getDb();
  return db.transaction(async (tx) => {
    const { d, f } = await loadDoc(tx, documentId);
    if (d.visibility !== "client") return { documentId };
    const at = now();
    const storage = getStorage();
    const internalKey = withVisibility(f.storageKey, "internal");
    await storage.copy(f.storageKey, internalKey);
    await storage.delete(f.storageKey);
    await tx.update(files).set({ storageKey: internalKey }).where(eq(files.id, f.id));
    await tx.update(documents).set({ visibility: "internal", publishedAt: null, publishedBy: null, updatedAt: at }).where(eq(documents.id, documentId));
    await logActivity(tx, { orgId: d.orgId, entityType: d.entityType, entityId: d.entityId, type: "document_unpublished", actorId: ctx.userId, actorName: ctx.name, visibility: "internal", at, payload: { documentId, filename: d.filename, kind: d.kind } });
    return { documentId };
  });
}

/** Soft delete (ops). */
export async function deleteDocument(ctx: Ctx, documentId: string) {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const db = await getDb();
  return db.transaction(async (tx) => {
    const { d } = await loadDoc(tx, documentId);
    const at = now();
    await tx.update(documents).set({ deletedAt: at, updatedAt: at }).where(eq(documents.id, documentId));
    await logActivity(tx, { orgId: d.orgId, entityType: d.entityType, entityId: d.entityId, type: "document_unpublished", actorId: ctx.userId, actorName: ctx.name, visibility: "internal", at, payload: { documentId, filename: d.filename, kind: d.kind, deleted: true } });
    return { documentId };
  });
}

/** Dry-run leak check for the publish dialog (no writes). */
/**
 * The Publish dialog's first step: runs the same leak check as `publishDocument`. Clicking Publish is the publish attempt,
 * so a hit on a publishable, still-internal document is recorded exactly like a blocked publish (SPEC AC-DOC-02:
 * "the timeline has `leak_check_blocked`") — the confirm button then stays disabled.
 */
export async function previewPublish(ctx: Ctx, documentId: string): Promise<{ filename: string; kind: DocumentKind; publishable: boolean; result: ReturnType<typeof publishLeakCheck>; hasText: boolean }> {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const db = await getDb();
  const { d, f } = await loadDoc(db, documentId);
  const sources = await loadLeakSources(db);
  let text = "";
  const obj = await getStorage().get(f.storageKey);
  if (obj) text = extractText(Buffer.from(await new Response(obj.body as ReadableStream).arrayBuffer()), f.mime, d.filename);
  const result = publishLeakCheck({ filename: d.filename, text }, sources);
  const publishable = isPublishableKind(d.kind) && !INTERNAL_ONLY_DOCUMENT_KINDS.includes(d.kind);
  if (!result.ok && publishable && d.visibility !== "client") {
    const at = now();
    const stored = { ok: false, at: at.toISOString(), hits: result.hits.map((h) => ({ kind: h.kind, match: h.match, where: h.where })) };
    await db.transaction(async (tx) => recordBlockedPublish(tx, ctx, d, stored, at));
  }
  return { filename: d.filename, kind: d.kind, publishable: isPublishableKind(d.kind), result, hasText: text.length > 0 };
}

type StoredLeakResult = { ok: boolean; at: string; hits: Array<{ kind: string; match: string; where: string }> };

/** A blocked publish: `leak_check_result` on the document, `leak_check_blocked` (internal) + `ops_leak_blocked` to the actor and admins (N-22). */
async function recordBlockedPublish(tx: DbOrTx, ctx: Ctx, d: { id: string; orgId: string; entityType: EntityType; entityId: string; filename: string; kind: DocumentKind }, stored: StoredLeakResult, at: Date) {
  await tx.update(documents).set({ leakCheckResult: stored as never, updatedAt: at }).where(eq(documents.id, d.id));
  await logActivity(tx, { orgId: d.orgId, entityType: d.entityType, entityId: d.entityId, type: "leak_check_blocked", actorId: ctx.userId, actorName: ctx.name, visibility: "internal", at, payload: { documentId: d.id, filename: d.filename, kind: d.kind, hits: stored.hits } });
  const entityRef = await refFor(tx, d.entityType, d.entityId);
  for (const u of (await opsUsers(tx)).filter((u) => u.role === "admin" || u.id === ctx.userId)) {
    await enqueue({ userId: u.id, toEmail: u.email, template: "ops_leak_blocked", entityRef, subject: `Publish blocked on ${entityRef}: supplier identifier found`, payload: { ref: entityRef, filename: d.filename, hits: stored.hits, url: `/ops` }, idempotencyKey: `ops_leak_blocked:${d.id}:${at.toISOString()}:${u.id}`, at }, tx);
  }
}

async function refFor(db: DbOrTx, entityType: EntityType, entityId: string): Promise<string> {
  if (entityType === "order") {
    const [o] = await db.select({ ref: orders.ref }).from(orders).where(eq(orders.id, entityId)).limit(1);
    return o?.ref ?? entityId;
  }
  if (entityType === "request_line") {
    const { requestLines } = await import("@/db/schema/app");
    const [l] = await db.select({ ref: requestLines.lineRef }).from(requestLines).where(eq(requestLines.id, entityId)).limit(1);
    return l?.ref ?? entityId;
  }
  return entityId;
}
