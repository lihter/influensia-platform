/**
 * Factory ranges (SPEC F-25, D-15). Ops builds a range for one supplier × one client org: a sanitised PDF (internal
 * until publish), items with optional clean images, then "Publish to client" runs the leak check over every item
 * name/note, every filename and the PDF text layer, assigns "Factory F-nnnn" from the FACTORY_LABEL sequence at first
 * publish, copies the PDF (and item images) to the client prefix, logs `range_published` and notifies the client.
 */
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { inflateSync } from "node:zlib";
import { uuidv7 } from "uuidv7";
import { getDb, type DbOrTx } from "@/db";
import { factoryRanges, factoryRangeItems, organizations, files, documents, products, requestLines } from "@/db/schema/app";
import { suppliers } from "@/db/schema/supplier";
import { type Ctx, isOps, isAdmin, Forbidden, NotFound } from "@/server/shared/authorize";
import { logActivity } from "@/server/shared/activity";
import { enqueue } from "@/server/shared/outbox";
import { storeUpload } from "@/server/shared/files";
import { getStorage } from "@/server/shared/storage";
import { leakCheck, loadLeakSources, LeakCheckError, type LeakHit } from "@/server/shared/leak-check";
import { nextRef } from "@/server/shared/ids";
import { now } from "@/server/shared/clock";
import { clientUsersOf, opsUsers, userNames } from "@/server/shared/users";
import type { LeakCheckStored } from "@/db/types";

/* ───────────────────────── PDF text layer (best effort, no dependency) ───────────────────────── */

/**
 * Extracts the text layer of simple PDFs: walks every `stream … endstream`, inflates FlateDecode streams, then pulls
 * string operands of `Tj` / `TJ` / `'` / `"`. Enough for generated and most office-exported PDFs; scanned PDFs yield "".
 * (SPEC F-23 names `pdf-parse`; it is not in package.json, so this stays dependency-free.)
 */
export function extractPdfText(data: Buffer): string {
  const raw = data.toString("latin1");
  const out: string[] = [];
  const re = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    let body = m[1];
    const head = raw.slice(Math.max(0, m.index - 400), m.index);
    if (/FlateDecode/.test(head)) {
      try { body = inflateSync(Buffer.from(body, "latin1")).toString("latin1"); } catch { continue; }
    }
    for (const s of body.matchAll(/\(((?:\\.|[^\\)])*)\)\s*(?:Tj|'|")/g)) out.push(unescapePdf(s[1]));
    for (const arr of body.matchAll(/\[((?:\\.|[^\]])*)\]\s*TJ/g)) for (const s of arr[1].matchAll(/\(((?:\\.|[^\\)])*)\)/g)) out.push(unescapePdf(s[1]));
    for (const hex of body.matchAll(/<([0-9A-Fa-f\s]+)>\s*Tj/g)) { const h = hex[1].replace(/\s/g, ""); if (h.length % 4 === 0) { let t = ""; for (let i = 0; i < h.length; i += 4) t += String.fromCharCode(parseInt(h.slice(i, i + 4), 16)); out.push(t); } }
  }
  return out.join(" ").replace(/\s+/g, " ").trim();
}
const unescapePdf = (s: string) => s.replace(/\\([nrtbf()\\]|\d{1,3})/g, (_, c: string) => (c === "n" ? "\n" : c === "r" ? "\r" : c === "t" ? "\t" : c === "b" ? "\b" : c === "f" ? "\f" : /^\d/.test(c) ? String.fromCharCode(parseInt(c, 8)) : c));

/* ───────────────────────── shapes ───────────────────────── */

export type RangeRow = { id: string; ref: string; label: string | null; supplierRef: string; supplierName: string; orgId: string; orgName: string; itemCount: number; hasPdf: boolean; publishedAt: string | null; createdAt: string; updatedAt: string; leakOk: boolean | null };
export type RangeItem = { id: string; name: string; productId: string | null; productRef: string | null; imageUrl: string | null; imageFilename: string | null; moq: number | null; priceMinorE2: number | null; currency: string; unit: string; madeHere: boolean | null; note: string | null; sortOrder: number };
export type RangeDetail = {
  id: string; ref: string; label: string | null; supplierId: string; supplierRef: string; supplierName: string; supplierCity: string | null; orgId: string; orgName: string;
  pdfSource: { fileId: string; filename: string; bytes: number; url: string } | null;
  pdfClient: { fileId: string; filename: string; bytes: number; url: string } | null;
  items: RangeItem[];
  publishedAt: string | null; approvedByName: string | null; leakCheckResult: LeakCheckStored | null; createdAt: string; updatedAt: string; createdByName: string | null;
  linesFromRange: { lineRef: string; name: string; state: string; createdAt: string }[];
};

export async function listRanges(ctx: Ctx): Promise<RangeRow[]> {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const db = await getDb();
  const rows = await db
    .select({ r: factoryRanges, orgName: organizations.name, supplierRef: suppliers.ref, supplierName: suppliers.legalName, itemCount: sql<number>`(select count(*) from app.factory_range_items i where i.range_id = ${factoryRanges.id})` })
    .from(factoryRanges).innerJoin(organizations, eq(organizations.id, factoryRanges.orgId)).innerJoin(suppliers, eq(suppliers.id, factoryRanges.supplierId))
    .where(isNull(factoryRanges.deletedAt)).orderBy(desc(factoryRanges.ref));
  return rows.map(({ r, orgName, supplierRef, supplierName, itemCount }) => ({
    id: r.id, ref: r.ref, label: r.label, supplierRef, supplierName, orgId: r.orgId, orgName, itemCount: Number(itemCount), hasPdf: !!(r.pdfSourceFileId || r.pdfFileId),
    publishedAt: r.publishedAt?.toISOString() ?? null, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(), leakOk: r.leakCheckResult ? r.leakCheckResult.ok : null,
  }));
}

async function loadRange(db: DbOrTx, where: { ref?: string; id?: string }) {
  const cond = where.id ? eq(factoryRanges.id, where.id) : eq(factoryRanges.ref, where.ref!);
  const [row] = await db.select({ r: factoryRanges, orgName: organizations.name, s: suppliers }).from(factoryRanges).innerJoin(organizations, eq(organizations.id, factoryRanges.orgId)).innerJoin(suppliers, eq(suppliers.id, factoryRanges.supplierId)).where(and(cond, isNull(factoryRanges.deletedAt))).limit(1);
  if (!row) throw new NotFound("range");
  return row;
}

export async function getRange(ctx: Ctx, ref: string): Promise<RangeDetail> {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const db = await getDb();
  const { r, orgName, s } = await loadRange(db, { ref });
  const items = await db.select({ i: factoryRangeItems, productRef: products.ref }).from(factoryRangeItems).leftJoin(products, eq(products.id, factoryRangeItems.productId)).where(eq(factoryRangeItems.rangeId, r.id)).orderBy(asc(factoryRangeItems.sortOrder), asc(factoryRangeItems.createdAt));
  const fileIds = [r.pdfSourceFileId, r.pdfFileId, ...items.map((x) => x.i.cleanImageFileId)].filter((x): x is string => !!x);
  const fRows = fileIds.length ? await db.select().from(files).where(inArray(files.id, fileIds)) : [];
  const fBy = new Map(fRows.map((f) => [f.id, f]));
  const fileOf = (id: string | null) => { const f = id ? fBy.get(id) : null; return f ? { fileId: f.id, filename: f.originalName, bytes: f.bytes, url: `/api/files/${f.storageKey}` } : null; };
  const names = await userNames(db, [r.approvedBy, r.createdBy].filter((x): x is string => !!x));
  const lines = await db.select({ lineRef: requestLines.lineRef, name: requestLines.name, state: requestLines.state, createdAt: requestLines.createdAt }).from(requestLines).where(and(eq(requestLines.fromRangeId, r.id), isNull(requestLines.deletedAt))).orderBy(desc(requestLines.createdAt));
  return {
    id: r.id, ref: r.ref, label: r.label, supplierId: s.id, supplierRef: s.ref, supplierName: s.legalName, supplierCity: s.city, orgId: r.orgId, orgName,
    pdfSource: fileOf(r.pdfSourceFileId), pdfClient: fileOf(r.pdfFileId),
    items: items.map(({ i, productRef }) => { const img = fileOf(i.cleanImageFileId); return { id: i.id, name: i.name, productId: i.productId, productRef, imageUrl: img?.url ?? null, imageFilename: img?.filename ?? null, moq: i.moq, priceMinorE2: i.priceMinorE2, currency: i.currency, unit: i.unit, madeHere: i.madeHere, note: i.note, sortOrder: i.sortOrder }; }),
    publishedAt: r.publishedAt?.toISOString() ?? null, approvedByName: r.approvedBy ? names[r.approvedBy] ?? null : null, leakCheckResult: r.leakCheckResult, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(), createdByName: r.createdBy ? names[r.createdBy] ?? null : null,
    linesFromRange: lines.map((l) => ({ lineRef: l.lineRef, name: l.name, state: l.state, createdAt: l.createdAt.toISOString() })),
  };
}

/* ───────────────────────── mutations ───────────────────────── */

export async function createRange(ctx: Ctx, input: { supplierId: string; orgId: string }): Promise<{ id: string; ref: string }> {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const db = await getDb();
  const [s] = await db.select({ id: suppliers.id, ref: suppliers.ref, legalName: suppliers.legalName }).from(suppliers).where(and(eq(suppliers.id, input.supplierId), isNull(suppliers.deletedAt))).limit(1);
  if (!s) throw new NotFound("supplier");
  const [org] = await db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(and(eq(organizations.id, input.orgId), eq(organizations.type, "client"), isNull(organizations.deletedAt))).limit(1);
  if (!org) throw new NotFound("client");
  const ref = await nextRef(db, "FR");
  const id = uuidv7();
  const at = now();
  await db.transaction(async (tx) => {
    await tx.insert(factoryRanges).values({ id, ref, orgId: org.id, supplierId: s.id as never, createdBy: ctx.userId, createdAt: at, updatedAt: at });
    await logActivity(tx, { orgId: org.id, entityType: "factory_range", entityId: id, type: "line_updated", actorId: ctx.userId, actorName: ctx.name, visibility: "internal", at, payload: { action: "range_created", ref, supplierRef: s.ref, supplierName: s.legalName, orgName: org.name } });
  });
  return { id, ref };
}

/** Sanitised PDF: stored internal (source) until publish. Re-upload replaces the source and clears the previous leak result. */
export async function uploadRangePdf(ctx: Ctx, p: { rangeId: string; data: Buffer; mime: string; filename: string }): Promise<{ fileId: string }> {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  if (p.mime !== "application/pdf" && !p.filename.toLowerCase().endsWith(".pdf")) throw new Forbidden("PDF only");
  const db = await getDb();
  const { r } = await loadRange(db, { id: p.rangeId });
  const at = now();
  return db.transaction(async (tx) => {
    const f = await storeUpload(tx, { orgId: r.orgId, userId: ctx.userId, data: p.data, mime: "application/pdf", originalName: p.filename, entity: "factory_range", entityId: r.id, visibility: "internal", at });
    await tx.update(factoryRanges).set({ pdfSourceFileId: f.id, leakCheckResult: null, updatedAt: at }).where(eq(factoryRanges.id, r.id));
    await logActivity(tx, { orgId: r.orgId, entityType: "factory_range", entityId: r.id, type: "document_uploaded", actorId: ctx.userId, actorName: ctx.name, visibility: "internal", at, payload: { ref: r.ref, filename: p.filename, kind: "factory_range_pdf", bytes: f.bytes } });
    return { fileId: f.id };
  });
}

export type RangeItemInput = { name: string; productId?: string | null; moq?: number | null; priceMinorE2?: number | null; currency?: string; unit?: string; madeHere?: boolean | null; note?: string | null };
const clean = (v: string | null | undefined) => { const t = v?.trim(); return t ? t : null; };

export async function addRangeItem(ctx: Ctx, rangeId: string, input: RangeItemInput): Promise<{ id: string }> {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const db = await getDb();
  const { r } = await loadRange(db, { id: rangeId });
  const [{ max }] = await db.select({ max: sql<number>`coalesce(max(${factoryRangeItems.sortOrder}), -1)` }).from(factoryRangeItems).where(eq(factoryRangeItems.rangeId, r.id));
  const id = uuidv7();
  const at = now();
  await db.transaction(async (tx) => {
    await tx.insert(factoryRangeItems).values({ id, rangeId: r.id, productId: input.productId || null, name: input.name.trim(), moq: input.moq ?? null, priceMinorE2: input.priceMinorE2 ?? null, currency: input.currency ?? "USD", unit: clean(input.unit) ?? "pcs", madeHere: input.madeHere ?? null, note: clean(input.note), sortOrder: Number(max) + 1, createdAt: at });
    await tx.update(factoryRanges).set({ leakCheckResult: null, updatedAt: at }).where(eq(factoryRanges.id, r.id));
    await logActivity(tx, { orgId: r.orgId, entityType: "factory_range", entityId: r.id, type: "line_updated", actorId: ctx.userId, actorName: ctx.name, visibility: "internal", at, payload: { action: "range_item_added", ref: r.ref, name: input.name.trim() } });
  });
  return { id };
}

export async function updateRangeItem(ctx: Ctx, itemId: string, input: RangeItemInput): Promise<void> {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const db = await getDb();
  const [it] = await db.select().from(factoryRangeItems).where(eq(factoryRangeItems.id, itemId)).limit(1);
  if (!it) throw new NotFound("item");
  const { r } = await loadRange(db, { id: it.rangeId });
  const at = now();
  await db.transaction(async (tx) => {
    await tx.update(factoryRangeItems).set({ productId: input.productId || null, name: input.name.trim(), moq: input.moq ?? null, priceMinorE2: input.priceMinorE2 ?? null, currency: input.currency ?? it.currency, unit: clean(input.unit) ?? it.unit, madeHere: input.madeHere ?? null, note: clean(input.note) }).where(eq(factoryRangeItems.id, itemId));
    await tx.update(factoryRanges).set({ leakCheckResult: null, updatedAt: at }).where(eq(factoryRanges.id, r.id));
    await logActivity(tx, { orgId: r.orgId, entityType: "factory_range", entityId: r.id, type: "line_updated", actorId: ctx.userId, actorName: ctx.name, visibility: "internal", at, payload: { action: "range_item_updated", ref: r.ref, itemId } });
  });
}

export async function removeRangeItem(ctx: Ctx, itemId: string): Promise<void> {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const db = await getDb();
  const [it] = await db.select().from(factoryRangeItems).where(eq(factoryRangeItems.id, itemId)).limit(1);
  if (!it) throw new NotFound("item");
  const { r } = await loadRange(db, { id: it.rangeId });
  const at = now();
  await db.transaction(async (tx) => {
    await tx.delete(factoryRangeItems).where(eq(factoryRangeItems.id, itemId));
    await tx.update(factoryRanges).set({ leakCheckResult: null, updatedAt: at }).where(eq(factoryRanges.id, r.id));
    await logActivity(tx, { orgId: r.orgId, entityType: "factory_range", entityId: r.id, type: "line_updated", actorId: ctx.userId, actorName: ctx.name, visibility: "internal", at, payload: { action: "range_item_removed", ref: r.ref, name: it.name } });
  });
}

/** Item clean image: stored internal before publish; published copies are made at publish time. */
export async function uploadRangeItemImage(ctx: Ctx, p: { itemId: string; data: Buffer; mime: string; filename: string }): Promise<{ fileId: string }> {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  if (!/^image\/(jpeg|png|webp)$/.test(p.mime)) throw new Forbidden("images only (png, jpg, webp)");
  const db = await getDb();
  const [it] = await db.select().from(factoryRangeItems).where(eq(factoryRangeItems.id, p.itemId)).limit(1);
  if (!it) throw new NotFound("item");
  const { r } = await loadRange(db, { id: it.rangeId });
  const at = now();
  return db.transaction(async (tx) => {
    const f = await storeUpload(tx, { orgId: r.orgId, userId: ctx.userId, data: p.data, mime: p.mime, originalName: p.filename, entity: "factory_range", entityId: r.id, visibility: r.publishedAt ? "client" : "internal", at });
    await tx.update(factoryRangeItems).set({ cleanImageFileId: f.id }).where(eq(factoryRangeItems.id, it.id));
    await tx.update(factoryRanges).set({ leakCheckResult: null, updatedAt: at }).where(eq(factoryRanges.id, r.id));
    await logActivity(tx, { orgId: r.orgId, entityType: "factory_range", entityId: r.id, type: "line_updated", actorId: ctx.userId, actorName: ctx.name, visibility: "internal", at, payload: { action: "range_item_image", ref: r.ref, itemId: it.id, filename: p.filename } });
    return { fileId: f.id };
  });
}

async function readObject(key: string): Promise<Buffer> {
  const obj = await getStorage().get(key);
  if (!obj) throw new NotFound("file");
  const chunks: Buffer[] = [];
  for await (const c of obj.body as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks);
}

export type RangeLeakReport = { ok: boolean; hits: LeakHit[]; checked: { items: number; filenames: number; pdfChars: number } };

/** Dry run of the publish leak check (the dialog shows this before the admin confirms). */
export async function checkRange(ctx: Ctx, rangeId: string): Promise<RangeLeakReport> {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const db = await getDb();
  const { r } = await loadRange(db, { id: rangeId });
  return runLeakCheck(db, r.id);
}

async function runLeakCheck(db: DbOrTx, rangeId: string): Promise<RangeLeakReport> {
  const [r] = await db.select().from(factoryRanges).where(eq(factoryRanges.id, rangeId)).limit(1);
  const items = await db.select().from(factoryRangeItems).where(eq(factoryRangeItems.rangeId, rangeId));
  const fileIds = [r.pdfSourceFileId, ...items.map((i) => i.cleanImageFileId)].filter((x): x is string => !!x);
  const fRows = fileIds.length ? await db.select().from(files).where(inArray(files.id, fileIds)) : [];
  const fBy = new Map(fRows.map((f) => [f.id, f]));
  let pdfText = "";
  const pdf = r.pdfSourceFileId ? fBy.get(r.pdfSourceFileId) : null;
  if (pdf) pdfText = extractPdfText(await readObject(pdf.storageKey));
  const fields: Record<string, string | null> = {};
  for (const [i, it] of items.entries()) { fields[`item ${i + 1} name`] = it.name; fields[`item ${i + 1} note`] = it.note; }
  const filenames = fRows.map((f) => f.originalName);
  const sources = await loadLeakSources(db, { fresh: true });
  const res = leakCheck({ fields, filenames, pdfText }, sources);
  return { ok: res.ok, hits: res.ok ? [] : res.hits, checked: { items: items.length, filenames: filenames.length, pdfChars: pdfText.length } };
}

/**
 * Publish to client (admin). On a leak hit: nothing changes except `leak_check_result`, `leak_check_blocked` (internal)
 * and `ops_leak_blocked` to the acting user + admins; throws LeakCheckError (→ E_LEAK_CHECK with hits).
 */
export async function publishRange(ctx: Ctx, rangeId: string): Promise<{ ref: string; label: string }> {
  if (!isAdmin(ctx)) throw new Forbidden("admin only");
  const db = await getDb();
  const { r, orgName, s } = await loadRange(db, { id: rangeId });
  const items = await db.select().from(factoryRangeItems).where(eq(factoryRangeItems.rangeId, r.id)).orderBy(asc(factoryRangeItems.sortOrder));
  if (!items.length) throw new Forbidden("add at least one item before publishing");
  const at = now();
  const report = await runLeakCheck(db, r.id);
  const stored: LeakCheckStored = { ok: report.ok, at: at.toISOString(), hits: report.hits.map((h) => ({ kind: h.kind, match: h.match, where: h.where })) };
  if (!report.ok) {
    await db.transaction(async (tx) => {
      await tx.update(factoryRanges).set({ leakCheckResult: stored, updatedAt: at }).where(eq(factoryRanges.id, r.id));
      await logActivity(tx, { orgId: r.orgId, entityType: "factory_range", entityId: r.id, type: "leak_check_blocked", actorId: ctx.userId, actorName: ctx.name, visibility: "internal", at, payload: { ref: r.ref, hits: stored.hits } });
      const ops = await opsUsers(tx);
      for (const u of ops.filter((u) => u.role === "admin" || u.id === ctx.userId)) {
        await enqueue({ userId: u.id, toEmail: u.email, template: "ops_leak_blocked", subject: `Publish blocked on ${r.ref}: supplier identifier found`, entityRef: r.ref, payload: { ref: r.ref, hits: stored.hits, url: `/ops/factory-ranges/${r.ref}` }, idempotencyKey: `ops_leak_blocked:${r.id}:${at.toISOString()}:${u.id}`, at }, tx);
      }
    });
    throw new LeakCheckError(report.hits);
  }
  const label = r.label ?? (await nextRef(db, "FACTORY_LABEL"));
  const fileIds = [r.pdfSourceFileId, ...items.map((i) => i.cleanImageFileId)].filter((x): x is string => !!x);
  const fRows = fileIds.length ? await db.select().from(files).where(inArray(files.id, fileIds)) : [];
  const fBy = new Map(fRows.map((f) => [f.id, f]));
  await db.transaction(async (tx) => {
    let pdfFileId = r.pdfFileId;
    const src = r.pdfSourceFileId ? fBy.get(r.pdfSourceFileId) : null;
    if (src) {
      const copy = await storeUpload(tx, { orgId: r.orgId, userId: ctx.userId, data: await readObject(src.storageKey), mime: src.mime, originalName: `Factory-${label}-range.pdf`, entity: "factory_range", entityId: r.id, visibility: "client", at });
      pdfFileId = copy.id;
      // retire earlier client copies' documents rows, add the new one (kind factory_range_pdf, client)
      await tx.update(documents).set({ visibility: "internal", updatedAt: at }).where(and(eq(documents.entityType, "factory_range"), eq(documents.entityId, r.id), eq(documents.kind, "factory_range_pdf")));
      await tx.insert(documents).values({ id: uuidv7(), orgId: r.orgId, entityType: "factory_range", entityId: r.id, fileId: copy.id, filename: `Factory-${label}-range.pdf`, kind: "factory_range_pdf", visibility: "client", uploadedBy: ctx.userId, publishedAt: at, publishedBy: ctx.userId, leakCheckResult: stored, createdBy: ctx.userId, createdAt: at, updatedAt: at });
    }
    for (const it of items) {
      const img = it.cleanImageFileId ? fBy.get(it.cleanImageFileId) : null;
      if (img && img.storageKey.includes("/internal/")) {
        const copy = await storeUpload(tx, { orgId: r.orgId, userId: ctx.userId, data: await readObject(img.storageKey), mime: img.mime, originalName: img.originalName, entity: "factory_range", entityId: r.id, visibility: "client", at });
        await tx.update(factoryRangeItems).set({ cleanImageFileId: copy.id }).where(eq(factoryRangeItems.id, it.id));
      }
    }
    await tx.update(factoryRanges).set({ label, pdfFileId, approvedBy: ctx.userId, publishedAt: at, leakCheckResult: stored, updatedAt: at }).where(eq(factoryRanges.id, r.id));
    await logActivity(tx, { orgId: r.orgId, entityType: "factory_range", entityId: r.id, type: "range_published", actorId: ctx.userId, actorName: ctx.name, visibility: "client", at, payload: { text: "More from this factory is available", factoryLabel: label, itemCount: items.length, url: `/app/ranges/${r.id}` } });
    await logActivity(tx, { orgId: r.orgId, entityType: "supplier", entityId: s.id, type: "range_published", actorId: ctx.userId, actorName: ctx.name, visibility: "internal", at, payload: { ref: r.ref, label, orgName, itemCount: items.length } });
    for (const u of await clientUsersOf(tx, r.orgId)) {
      await enqueue({ userId: u.id, toEmail: u.email, template: "client_new_update", subject: `Update on Factory ${label}`, entityRef: label, payload: { text: "More from this factory is available", factoryLabel: label, itemCount: items.length, url: `/app/ranges/${r.id}` }, idempotencyKey: `client_new_update:${r.id}:published:${at.toISOString()}:${u.id}`, at }, tx);
    }
  });
  return { ref: r.ref, label };
}

/** Unpublish: hides the range from the client (label is kept, never reused). */
export async function unpublishRange(ctx: Ctx, rangeId: string): Promise<{ ref: string }> {
  if (!isAdmin(ctx)) throw new Forbidden("admin only");
  const db = await getDb();
  const { r } = await loadRange(db, { id: rangeId });
  const at = now();
  await db.transaction(async (tx) => {
    await tx.update(factoryRanges).set({ publishedAt: null, updatedAt: at }).where(eq(factoryRanges.id, r.id));
    await tx.update(documents).set({ visibility: "internal", updatedAt: at }).where(and(eq(documents.entityType, "factory_range"), eq(documents.entityId, r.id), eq(documents.kind, "factory_range_pdf")));
    await logActivity(tx, { orgId: r.orgId, entityType: "factory_range", entityId: r.id, type: "document_unpublished", actorId: ctx.userId, actorName: ctx.name, visibility: "internal", at, payload: { action: "range_unpublished", ref: r.ref, label: r.label } });
  });
  return { ref: r.ref };
}

export async function productOptions(ctx: Ctx): Promise<{ id: string; ref: string; name: string }[]> {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const db = await getDb();
  return db.select({ id: products.id, ref: products.ref, name: products.name }).from(products).where(isNull(products.deletedAt)).orderBy(products.ref);
}
