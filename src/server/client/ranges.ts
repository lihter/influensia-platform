/**
 * Client side of factory ranges (SPEC F-25, D-15). Reads the app schema only: a range is `{label, items, pdf}` for the
 * org it was published to. "Which of my products does this factory make" comes from the shared `factoryLabelForLine`
 * helper (the only sanctioned supplier-schema read for client code — it returns a label, nothing else).
 *
 * "Request these items" creates a request whose lines start in `negotiating` with the factory pre-selected. The
 * participation row lives in the supplier schema, which this module may not import (ESLint boundary), so the insert is
 * a parameterised raw statement keyed by the range's server-only `supplier_id`; nothing is read back from it.
 */
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { getDb } from "@/db";
import { factoryRanges, factoryRangeItems, files, requests, requestLines, orders, orderLines } from "@/db/schema/app";
import { type Ctx, isClient, Forbidden, NotFound } from "@/server/shared/authorize";
import { logActivity } from "@/server/shared/activity";
import { enqueue } from "@/server/shared/outbox";
import { factoryLabelForLine } from "@/server/shared/sourcing-counts";
import { isFeedState } from "@/server/shared/state-machine";
import { nextRef, lineRef as mkLineRef } from "@/server/shared/ids";
import { now } from "@/server/shared/clock";
import { formatQty } from "@/server/shared/money";
import { opsUsers } from "@/server/shared/users";
import { ClientProductImageDto } from "./dto";
import { ClientRangeDto, ClientRangeSummaryDto, ClientRangeRequestDto, ClientRangePdfDto } from "./dto/ranges";

const labelOf = (label: string) => label.replace(/^Factory\s+/i, "");

/** label → { names, orderRefs } of this org's lines whose selected factory carries that label. */
async function linesByLabel(orgId: string): Promise<Map<string, { names: Set<string>; orderRefs: Set<string> }>> {
  const db = await getDb();
  const lines = await db.select({ id: requestLines.id, name: requestLines.name }).from(requestLines).where(and(eq(requestLines.orgId, orgId), isNull(requestLines.deletedAt)));
  const ols = lines.length ? await db.select({ lineId: orderLines.requestLineId, orderRef: orders.ref }).from(orderLines).innerJoin(orders, eq(orders.id, orderLines.orderId)).where(and(inArray(orderLines.requestLineId, lines.map((l) => l.id)), isNull(orders.deletedAt))) : [];
  const out = new Map<string, { names: Set<string>; orderRefs: Set<string> }>();
  for (const l of lines) {
    const label = await factoryLabelForLine(db, { lineId: l.id, orgId });
    if (!label) continue;
    const key = labelOf(label);
    const e = out.get(key) ?? { names: new Set(), orderRefs: new Set() };
    e.names.add(l.name);
    for (const o of ols.filter((x) => x.lineId === l.id)) e.orderRefs.add(o.orderRef);
    out.set(key, e);
  }
  return out;
}

type FileRow = { id: string; storageKey: string; originalName: string; bytes: number; exifStripped: boolean };
const clientKey = (f: FileRow | undefined | null) => (f && f.storageKey.includes("/client/") ? f : null);

async function loadFiles(ids: (string | null)[]): Promise<Map<string, FileRow>> {
  const clean = ids.filter((x): x is string => !!x);
  if (!clean.length) return new Map();
  const db = await getDb();
  const rows = await db.select({ id: files.id, storageKey: files.storageKey, originalName: files.originalName, bytes: files.bytes, exifStripped: files.exifStripped }).from(files).where(inArray(files.id, clean));
  return new Map(rows.map((r) => [r.id, r]));
}

function itemImage(f: FileRow | undefined | null, itemId: string) {
  const c = clientKey(f);
  return c && c.exifStripped ? ClientProductImageDto.parse({ id: itemId, url: `/api/files/${c.storageKey}` }) : null;
}

export async function listRanges(ctx: Ctx): Promise<ClientRangeSummaryDto[]> {
  if (!isClient(ctx)) throw new Forbidden("clients only");
  const db = await getDb();
  const rows = await db.select().from(factoryRanges).where(and(eq(factoryRanges.orgId, ctx.orgId), isNull(factoryRanges.deletedAt), sql`${factoryRanges.publishedAt} is not null`, sql`${factoryRanges.label} is not null`)).orderBy(factoryRanges.publishedAt);
  if (!rows.length) return [];
  const items = await db.select().from(factoryRangeItems).where(inArray(factoryRangeItems.rangeId, rows.map((r) => r.id))).orderBy(asc(factoryRangeItems.sortOrder));
  const [fileMap, byLabel] = await Promise.all([loadFiles(items.map((i) => i.cleanImageFileId)), linesByLabel(ctx.orgId)]);
  return rows.map((r) => {
    const its = items.filter((i) => i.rangeId === r.id);
    const first = its.find((i) => itemImage(fileMap.get(i.cleanImageFileId ?? ""), i.id));
    const l = byLabel.get(labelOf(r.label!));
    return ClientRangeSummaryDto.parse({
      id: r.id, factoryLabel: labelOf(r.label!), href: `/app/ranges/${r.id}`, itemCount: its.length,
      yourProducts: [...(l?.names ?? [])], orderRefs: [...(l?.orderRefs ?? [])], publishedAt: r.publishedAt!.toISOString(),
      image: first ? itemImage(fileMap.get(first.cleanImageFileId ?? ""), first.id) : null,
      preview: its.slice(0, 4).map((i) => ({ name: i.name, price: i.priceMinorE2 != null ? { minorE2: i.priceMinorE2, currency: i.currency, unit: i.unit } : null })),
    });
  });
}

export async function getRange(ctx: Ctx, id: string): Promise<ClientRangeDto> {
  if (!isClient(ctx)) throw new Forbidden("clients only");
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new NotFound("range");
  const db = await getDb();
  const [r] = await db.select().from(factoryRanges).where(and(eq(factoryRanges.id, id), eq(factoryRanges.orgId, ctx.orgId), isNull(factoryRanges.deletedAt))).limit(1);
  if (!r || !r.publishedAt || !r.label) throw new NotFound("range");
  const items = await db.select().from(factoryRangeItems).where(eq(factoryRangeItems.rangeId, r.id)).orderBy(asc(factoryRangeItems.sortOrder), asc(factoryRangeItems.createdAt));
  const [fileMap, byLabel] = await Promise.all([loadFiles([r.pdfFileId, ...items.map((i) => i.cleanImageFileId)]), linesByLabel(ctx.orgId)]);
  const pdf = clientKey(fileMap.get(r.pdfFileId ?? ""));
  const l = byLabel.get(labelOf(r.label));
  return ClientRangeDto.parse({
    id: r.id, factoryLabel: labelOf(r.label), yourProducts: [...(l?.names ?? [])], orderRefs: [...(l?.orderRefs ?? [])], publishedAt: r.publishedAt.toISOString(),
    pdf: pdf ? ClientRangePdfDto.parse({ filename: `Factory-${labelOf(r.label)}-range.pdf`, bytes: pdf.bytes, downloadUrl: `/api/files/${pdf.storageKey}?dl=1&filename=${encodeURIComponent(`Factory-${labelOf(r.label)}-range.pdf`)}` }) : null,
    items: items.map((i) => ({
      id: i.id, name: i.name, image: itemImage(fileMap.get(i.cleanImageFileId ?? ""), i.id), moq: i.moq, moqLabel: i.moq != null ? `MOQ ${formatQty(i.moq)}` : null, unit: i.unit,
      price: i.priceMinorE2 != null ? { minorE2: i.priceMinorE2, currency: i.currency, unit: i.unit } : null, madeHere: i.madeHere, note: i.note,
    })),
  });
}

/**
 * "Request these items" (AC-RNG-03): one request, one line per selected item in `negotiating` (skips RFQ), the factory
 * pre-selected on each line, `from_range_id` set, badge "From factory range". Ops gets `ops_new_request` ("Range request").
 */
export async function requestRangeItems(ctx: Ctx, input: { rangeId: string; items: { itemId: string; qty: number }[]; note?: string | null }): Promise<ClientRangeRequestDto> {
  if (!isClient(ctx)) throw new Forbidden("clients only");
  const db = await getDb();
  const [r] = await db.select().from(factoryRanges).where(and(eq(factoryRanges.id, input.rangeId), eq(factoryRanges.orgId, ctx.orgId), isNull(factoryRanges.deletedAt))).limit(1);
  if (!r || !r.publishedAt || !r.label) throw new NotFound("range");
  const wanted = new Map(input.items.map((i) => [i.itemId, i.qty]));
  const items = wanted.size ? await db.select().from(factoryRangeItems).where(and(eq(factoryRangeItems.rangeId, r.id), inArray(factoryRangeItems.id, [...wanted.keys()]))).orderBy(asc(factoryRangeItems.sortOrder)) : [];
  if (!items.length) throw new NotFound("items");
  const label = labelOf(r.label);
  const at = now();
  const requestRef = await nextRef(db, "REQ", at.getUTCFullYear());
  const requestId = uuidv7();
  const lineRefs: string[] = [];
  const userNote = input.note?.trim() || null;
  await db.transaction(async (tx) => {
    await tx.insert(requests).values({ id: requestId, ref: requestRef, orgId: ctx.orgId, source: "portal", status: "active", note: [`From Factory ${label} range`, userNote].filter(Boolean).join(" — "), submittedAt: at, createdBy: ctx.userId, createdAt: at, updatedAt: at });
    await logActivity(tx, { orgId: ctx.orgId, entityType: "request", entityId: requestId, type: "request_submitted", actorId: ctx.userId, actorName: ctx.name, visibility: "client", at, payload: { ref: requestRef, lines: items.length, factoryLabel: label } });
    for (const [idx, it] of items.entries()) {
      const lineId = uuidv7();
      const ref = mkLineRef(requestRef, idx + 1);
      lineRefs.push(ref);
      const qty = Math.max(1, Math.round(wanted.get(it.id) ?? it.moq ?? 1));
      const participationId = uuidv7();
      await tx.insert(requestLines).values({
        id: lineId, requestId, orgId: ctx.orgId, lineNo: idx + 1, lineRef: ref, productId: it.productId, name: it.name, qtyFirst: qty, unit: it.unit, customisation: userNote,
        state: "negotiating", milestone: "finding_factory", fromRangeId: r.id, sampleRequired: true, lastStateChangeAt: at, createdBy: ctx.userId, createdAt: at, updatedAt: at,
      });
      // participation `selected` for the range's factory — supplier schema, raw statement (see module comment)
      await tx.execute(sql`insert into supplier.supplier_participations (id, request_line_id, supplier_id, status, reason, first_contact_at, last_contact_at, created_by, created_at, updated_at)
        values (${participationId}::uuid, ${lineId}::uuid, ${r.supplierId as unknown as string}::uuid, 'selected', ${`From Factory ${label} range item`}, ${at.toISOString()}::timestamptz, ${at.toISOString()}::timestamptz, ${ctx.userId}, ${at.toISOString()}::timestamptz, ${at.toISOString()}::timestamptz)`);
      await tx.update(requestLines).set({ selectedParticipationId: participationId as never }).where(eq(requestLines.id, lineId));
      await logActivity(tx, { orgId: ctx.orgId, entityType: "request_line", entityId: lineId, type: "line_created", actorId: ctx.userId, actorName: ctx.name, visibility: "client", at, payload: { ref, name: it.name, qty, unit: it.unit, factoryLabel: label, text: `Requested from Factory ${label} — ${it.name}` } });
      await logActivity(tx, { orgId: ctx.orgId, entityType: "request_line", entityId: lineId, type: "state_changed", actorId: ctx.userId, actorName: ctx.name, visibility: "client", at, payload: { ref, from: "draft", to: "negotiating", milestone: "finding_factory", milestoneChanged: true, feed: isFeedState("negotiating"), note: null, factoryLabel: label } });
      await logActivity(tx, { orgId: ctx.orgId, entityType: "request_line", entityId: lineId, type: "participation_added", actorId: ctx.userId, actorName: ctx.name, visibility: "internal", at, payload: { ref, status: "selected", source: "factory_range", rangeRef: r.ref } });
    }
    for (const u of await opsUsers(tx)) {
      await enqueue({ userId: u.id, toEmail: u.email, template: "ops_new_request", subject: `Range request ${requestRef} (${items.length} lines)`, entityRef: requestRef, payload: { ref: requestRef, lines: lineRefs, rangeRef: r.ref, url: `/ops/requests/${requestRef}` }, idempotencyKey: `ops_new_request:${requestId}:${u.id}`, at }, tx);
    }
    await enqueue({ userId: ctx.userId, toEmail: ctx.email, template: "client_request_received", subject: `We received your request ${requestRef}`, entityRef: requestRef, payload: { ref: requestRef, lines: lineRefs, factoryLabel: label, url: `/app/requests/${requestRef}` }, idempotencyKey: `client_request_received:${requestId}:${ctx.userId}`, at }, tx);
  });
  return ClientRangeRequestDto.parse({ requestRef, lineRefs, factoryLabel: label });
}
