/**
 * Suppliers (SPEC F-21) — internal master data. One record per factory with contacts, verdict, grade, price lists,
 * participations across lines, performance and the `disclosed_to_org_ids` list. Everything here is ops-only.
 */
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { getDb, type DbOrTx } from "@/db";
import { suppliers, supplierContacts, supplierParticipations, quotes, quotePriceBreaks, supplierPriceLists, supplierCatalogues, supplierPerformance, purchaseOrders } from "@/db/schema/supplier";
import { requestLines, requests, organizations, documents, files, factoryRanges, orders } from "@/db/schema/app";
import { type Ctx, isOps, isAdmin, Forbidden, NotFound } from "@/server/shared/authorize";
import { logActivity } from "@/server/shared/activity";
import { storeDocument } from "@/server/shared/files";
import { stripCompanySuffix, invalidateLeakSources } from "@/server/shared/leak-check";
import { nextRef } from "@/server/shared/ids";
import { now } from "@/server/shared/clock";
import { userNames } from "@/server/shared/users";
import { SUPPLIER_TYPE_VERDICTS, VERDICT_SOURCES, SUPPLIER_GRADES, CONTACT_CHANNELS, type SupplierTypeVerdict, type VerdictSource, type SupplierGrade, type ContactChannel, type ParticipationStatus, type DocumentKind } from "@/db/enums";

/* Re-exported so page/action files (which may not import @/db/*) can build selects and zod enums. */
export { SUPPLIER_TYPE_VERDICTS, VERDICT_SOURCES, SUPPLIER_GRADES, CONTACT_CHANNELS };
export type { SupplierTypeVerdict, VerdictSource, SupplierGrade, ContactChannel, ParticipationStatus };
/** SPEC F-21 fixed port list. */
export const SUPPLIER_PORTS = ["Shenzhen", "Ningbo", "Shanghai", "Qingdao", "Xiamen", "Guangzhou", "Tianjin", "Yiwu", "other"] as const;

/* ───────────────────────── list ───────────────────────── */

export type SupplierRow = {
  id: string;
  ref: string;
  legalName: string;
  cnName: string | null;
  typeVerdict: SupplierTypeVerdict;
  verdictSource: VerdictSource | null;
  grade: SupplierGrade | null;
  city: string | null;
  province: string | null;
  country: string;
  channels: ContactChannel[];
  primaryContact: string | null;
  participations: number;
  openLines: number;
  ordersCount: number;
  onTimeRate: number | null;
  lastUsedAt: string | null;
  disclosedTo: string[];
  disclosed: boolean;
  createdAt: string;
};

export type SupplierFilters = { q?: string; verdict?: SupplierTypeVerdict | ""; grade?: SupplierGrade | ""; channel?: ContactChannel | ""; city?: string; disclosed?: boolean };

const ACTIVE_LINE_STATES = ["submitted", "in_review", "spec_frozen", "cost_target_price", "rfq_out", "quotes_in", "shortlisted", "negotiating", "offer_ready", "sampling", "offer_accepted"] as const;

export async function listSuppliers(ctx: Ctx, f: SupplierFilters = {}): Promise<SupplierRow[]> {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const db = await getDb();
  const sups = await db.select().from(suppliers).where(isNull(suppliers.deletedAt)).orderBy(suppliers.ref);
  if (!sups.length) return [];
  const ids = sups.map((s) => s.id);
  const [contacts, parts, perf, orgRows] = await Promise.all([
    db.select().from(supplierContacts).where(and(inArray(supplierContacts.supplierId, ids), isNull(supplierContacts.deletedAt))),
    db.select({ supplierId: supplierParticipations.supplierId, lineId: supplierParticipations.requestLineId, status: supplierParticipations.status, lastContactAt: supplierParticipations.lastContactAt, updatedAt: supplierParticipations.updatedAt, state: requestLines.state })
      .from(supplierParticipations).innerJoin(requestLines, eq(requestLines.id, supplierParticipations.requestLineId))
      .where(and(inArray(supplierParticipations.supplierId, ids), isNull(supplierParticipations.deletedAt))),
    db.select().from(supplierPerformance).where(inArray(supplierPerformance.supplierId, ids)),
    db.select({ id: organizations.id, name: organizations.name }).from(organizations),
  ]);
  const orgName = new Map(orgRows.map((o) => [o.id, o.name]));
  const perfBy = new Map(perf.map((p) => [p.supplierId, p]));
  const rows = sups.map((s) => {
    const cs = contacts.filter((c) => c.supplierId === s.id);
    const ps = parts.filter((p) => p.supplierId === s.id);
    const last = ps.map((p) => p.lastContactAt ?? p.updatedAt).filter((x): x is Date => !!x).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
    const pf = perfBy.get(s.id);
    const primary = cs.find((c) => c.isPrimary) ?? cs[0];
    return {
      id: s.id, ref: s.ref, legalName: s.legalName, cnName: s.cnName, typeVerdict: s.typeVerdict, verdictSource: s.verdictSource, grade: s.grade,
      city: s.city, province: s.province, country: s.country,
      channels: [...new Set(cs.map((c) => c.channel))],
      primaryContact: primary ? primary.name ?? primary.handle ?? null : null,
      participations: ps.length,
      openLines: new Set(ps.filter((p) => (ACTIVE_LINE_STATES as readonly string[]).includes(p.state) && p.status !== "dropped" && p.status !== "cannot_make").map((p) => p.lineId)).size,
      ordersCount: pf?.ordersCount ?? 0,
      onTimeRate: pf?.onTimeRate ?? null,
      lastUsedAt: (pf?.lastOrderAt && (!last || pf.lastOrderAt > last) ? pf.lastOrderAt : last)?.toISOString() ?? null,
      disclosedTo: s.disclosedToOrgIds.map((id) => orgName.get(id) ?? id),
      disclosed: s.disclosedToOrgIds.length > 0,
      createdAt: s.createdAt.toISOString(),
    } satisfies SupplierRow;
  });
  const q = f.q?.trim().toLowerCase();
  return rows.filter((r) => {
    if (f.verdict && r.typeVerdict !== f.verdict) return false;
    if (f.grade && r.grade !== f.grade) return false;
    if (f.channel && !r.channels.includes(f.channel)) return false;
    if (f.city && (r.city ?? "").toLowerCase() !== f.city.toLowerCase()) return false;
    if (f.disclosed && !r.disclosed) return false;
    if (q) {
      const cs = contacts.filter((c) => c.supplierId === r.id);
      const hay = [r.ref, r.legalName, r.cnName, r.city, ...cs.flatMap((c) => [c.name, c.handle, c.phone])].filter(Boolean).join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export async function supplierCities(ctx: Ctx): Promise<string[]> {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const db = await getDb();
  const rows = await db.select({ city: suppliers.city }).from(suppliers).where(isNull(suppliers.deletedAt));
  return [...new Set(rows.map((r) => r.city).filter((x): x is string => !!x))].sort();
}

/** Minimal option list for pickers (sourcing board, factory ranges). */
export async function supplierOptions(ctx: Ctx): Promise<{ id: string; ref: string; legalName: string; cnName: string | null; city: string | null; typeVerdict: SupplierTypeVerdict }[]> {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const db = await getDb();
  return db.select({ id: suppliers.id, ref: suppliers.ref, legalName: suppliers.legalName, cnName: suppliers.cnName, city: suppliers.city, typeVerdict: suppliers.typeVerdict }).from(suppliers).where(isNull(suppliers.deletedAt)).orderBy(suppliers.ref);
}

/* ───────────────────────── detail ───────────────────────── */

export type SupplierContact = { id: string; name: string | null; channel: ContactChannel; handle: string | null; phone: string | null; isPrimary: boolean };
export type SupplierDocument = { id: string; kind: "price_list" | "catalogue"; filename: string; bytes: number; storageKey: string; receivedAt: string | null; validUntil: string | null; currency: string | null; notes: string | null; uploadedBy: string | null };
export type SupplierParticipation = {
  id: string; lineId: string; lineRef: string; lineName: string; requestRef: string; orgName: string; lineState: string; status: ParticipationStatus; reason: string | null;
  contactName: string | null; firstContactAt: string | null; lastContactAt: string | null; quotesCount: number;
  latestQuote: { id: string; version: number; currency: string; unit: string; incoterm: string | null; incotermUncertain: boolean; port: string | null; moq: number | null; leadDays: number | null; validUntil: string | null; unitPriceMinorE2: number | null; usdMinorE2: number | null; receivedAt: string } | null;
};
export type SupplierDetail = {
  id: string; ref: string; legalName: string; cnName: string | null; normalisedName: string; typeVerdict: SupplierTypeVerdict; verdictSource: VerdictSource | null; verdictCheckedAt: string | null;
  grade: SupplierGrade | null; uscc: string | null; registeredAt: string | null; capital: string | null; city: string | null; province: string | null; country: string; ports: string[]; website: string | null; notes: string | null;
  disclosedTo: { orgId: string; name: string }[];
  createdAt: string; updatedAt: string; createdByName: string | null;
  contacts: SupplierContact[];
  documents: SupplierDocument[];
  participations: SupplierParticipation[];
  performance: { ordersCount: number; onTimeRate: number | null; defectRate: number | null; quoteAccuracy: number | null; lastOrderAt: string | null };
  purchaseOrders: { id: string; ref: string; orderRef: string; orgName: string; status: string; factoryTotalMinor: number; currency: string; issuedAt: string | null }[];
  ranges: { id: string; ref: string; label: string | null; orgName: string; publishedAt: string | null; itemCount: number }[];
};

export async function getSupplier(ctx: Ctx, ref: string): Promise<SupplierDetail> {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const db = await getDb();
  const [s] = await db.select().from(suppliers).where(and(eq(suppliers.ref, ref), isNull(suppliers.deletedAt))).limit(1);
  if (!s) throw new NotFound("supplier");
  const [contacts, pl, cat, parts, perf, pos, ranges, orgRows] = await Promise.all([
    db.select().from(supplierContacts).where(and(eq(supplierContacts.supplierId, s.id), isNull(supplierContacts.deletedAt))).orderBy(desc(supplierContacts.isPrimary), supplierContacts.createdAt),
    db.select().from(supplierPriceLists).where(eq(supplierPriceLists.supplierId, s.id)),
    db.select().from(supplierCatalogues).where(eq(supplierCatalogues.supplierId, s.id)),
    db.select({ p: supplierParticipations, line: requestLines, requestRef: requests.ref, orgName: organizations.name })
      .from(supplierParticipations).innerJoin(requestLines, eq(requestLines.id, supplierParticipations.requestLineId)).innerJoin(requests, eq(requests.id, requestLines.requestId)).innerJoin(organizations, eq(organizations.id, requestLines.orgId))
      .where(and(eq(supplierParticipations.supplierId, s.id), isNull(supplierParticipations.deletedAt))).orderBy(desc(requests.ref), requestLines.lineNo),
    db.select().from(supplierPerformance).where(eq(supplierPerformance.supplierId, s.id)).limit(1),
    db.select({ po: purchaseOrders, orderRef: orders.ref, orgName: organizations.name }).from(purchaseOrders).innerJoin(orders, eq(orders.id, purchaseOrders.orderId)).innerJoin(organizations, eq(organizations.id, purchaseOrders.orgId)).where(and(eq(purchaseOrders.supplierId, s.id), isNull(purchaseOrders.deletedAt))).orderBy(desc(purchaseOrders.createdAt)),
    db.select({ r: factoryRanges, orgName: organizations.name, itemCount: sql<number>`(select count(*) from app.factory_range_items i where i.range_id = ${factoryRanges.id})` }).from(factoryRanges).innerJoin(organizations, eq(organizations.id, factoryRanges.orgId)).where(and(eq(factoryRanges.supplierId, s.id as never), isNull(factoryRanges.deletedAt))).orderBy(factoryRanges.ref),
    db.select({ id: organizations.id, name: organizations.name }).from(organizations),
  ]);
  const orgName = new Map(orgRows.map((o) => [o.id, o.name]));
  const docIds = [...pl, ...cat].map((d) => d.documentId).filter((x): x is string => !!x);
  const docRows = docIds.length
    ? await db.select({ d: documents, bytes: files.bytes, storageKey: files.storageKey }).from(documents).innerJoin(files, eq(files.id, documents.fileId)).where(and(inArray(documents.id, docIds), isNull(documents.deletedAt)))
    : [];
  const docBy = new Map(docRows.map((r) => [r.d.id, r]));
  const docs: SupplierDocument[] = [];
  for (const [kind, list] of [["price_list", pl], ["catalogue", cat]] as const) {
    for (const row of list) {
      const d = row.documentId ? docBy.get(row.documentId) : null;
      docs.push({ id: row.id, kind, filename: d?.d.filename ?? "(missing file)", bytes: d?.bytes ?? 0, storageKey: d?.storageKey ?? "", receivedAt: row.receivedAt?.toISOString() ?? null, validUntil: row.validUntil, currency: row.currency, notes: row.notes, uploadedBy: d?.d.uploadedBy ?? null });
    }
  }
  docs.sort((a, b) => (b.receivedAt ?? "").localeCompare(a.receivedAt ?? ""));

  const partIds = parts.map((r) => r.p.id);
  const qRows = partIds.length ? await db.select().from(quotes).where(inArray(quotes.participationId, partIds)).orderBy(desc(quotes.version), desc(quotes.receivedAt)) : [];
  const breakRows = qRows.length ? await db.select().from(quotePriceBreaks).where(inArray(quotePriceBreaks.quoteId, qRows.map((q) => q.id))) : [];
  const contactBy = new Map(contacts.map((c) => [c.id, c]));
  const participations: SupplierParticipation[] = parts.map(({ p, line, requestRef, orgName: on }) => {
    const qs = qRows.filter((q) => q.participationId === p.id);
    const q = qs[0] ?? null;
    const brks = q ? breakRows.filter((b) => b.quoteId === q.id).sort((a, b) => a.minQty - b.minQty) : [];
    const atQty = brks.length ? ([...brks].reverse().find((b) => b.minQty <= (line.qtyFirst ?? 0)) ?? brks[0]) : null;
    const c = p.contactId ? contactBy.get(p.contactId) : null;
    return {
      id: p.id, lineId: line.id, lineRef: line.lineRef, lineName: line.name, requestRef, orgName: on, lineState: line.state, status: p.status, reason: p.reason,
      contactName: c ? c.name ?? c.handle ?? null : null, firstContactAt: p.firstContactAt?.toISOString() ?? null, lastContactAt: p.lastContactAt?.toISOString() ?? null, quotesCount: qs.length,
      latestQuote: q ? { id: q.id, version: q.version, currency: q.currency, unit: q.unit, incoterm: q.incoterm, incotermUncertain: q.incotermUncertain, port: q.port, moq: q.moq, leadDays: q.leadDays, validUntil: q.validUntil, unitPriceMinorE2: atQty?.unitPriceMinorE2 ?? null, usdMinorE2: q.normalisedUsdMinorE2, receivedAt: q.receivedAt.toISOString() } : null,
    };
  });
  const names = await userNames(db, [s.createdBy ?? ""].filter(Boolean));
  const pf = perf[0];
  return {
    id: s.id, ref: s.ref, legalName: s.legalName, cnName: s.cnName, normalisedName: s.normalisedName, typeVerdict: s.typeVerdict, verdictSource: s.verdictSource, verdictCheckedAt: s.verdictCheckedAt?.toISOString() ?? null,
    grade: s.grade, uscc: s.uscc, registeredAt: s.registeredAt, capital: s.capital, city: s.city, province: s.province, country: s.country, ports: s.ports, website: s.website, notes: s.notes,
    disclosedTo: s.disclosedToOrgIds.map((id) => ({ orgId: id, name: orgName.get(id) ?? id })),
    createdAt: s.createdAt.toISOString(), updatedAt: s.updatedAt.toISOString(), createdByName: s.createdBy ? names[s.createdBy] ?? null : null,
    contacts: contacts.map((c) => ({ id: c.id, name: c.name, channel: c.channel, handle: c.handle, phone: c.phone, isPrimary: c.isPrimary })),
    documents: docs,
    participations,
    performance: { ordersCount: pf?.ordersCount ?? 0, onTimeRate: pf?.onTimeRate ?? null, defectRate: pf?.defectRate ?? null, quoteAccuracy: pf?.quoteAccuracy ?? null, lastOrderAt: pf?.lastOrderAt?.toISOString() ?? null },
    purchaseOrders: pos.map(({ po, orderRef, orgName: on }) => ({ id: po.id, ref: po.ref, orderRef, orgName: on, status: po.status, factoryTotalMinor: po.factoryTotalMinor, currency: po.currency, issuedAt: po.issuedAt?.toISOString() ?? null })),
    ranges: ranges.map(({ r, orgName: on, itemCount }) => ({ id: r.id, ref: r.ref, label: r.label, orgName: on, publishedAt: r.publishedAt?.toISOString() ?? null, itemCount: Number(itemCount) })),
  };
}

/* ───────────────────────── mutations ───────────────────────── */

export type SupplierInput = {
  legalName: string; cnName?: string | null; typeVerdict?: SupplierTypeVerdict; verdictSource?: VerdictSource | null; grade?: SupplierGrade | null; uscc?: string | null;
  registeredAt?: string | null; capital?: string | null; city?: string | null; province?: string | null; country?: string | null; ports?: string[]; website?: string | null; notes?: string | null;
};
export type ContactInput = { name?: string | null; channel: ContactChannel; handle?: string | null; phone?: string | null; isPrimary?: boolean };

export class DuplicateSupplier extends Error {
  code = "E_DUPLICATE_SUPPLIER" as const;
  status = 409;
  constructor(public existing: { ref: string; legalName: string }) { super(`E_DUPLICATE_SUPPLIER: ${existing.ref}`); }
}

/** SPEC F-21: unique on normalised name (lowercase, punctuation stripped, Co Ltd variants collapsed). */
export const normaliseSupplierName = (name: string) => stripCompanySuffix(name).replace(/\s+/g, " ").trim();

/** Words that never identify a factory on their own (cities, provinces, trade words) — same spirit as the leak check's generic set. */
const GENERIC_WORDS = new Set([
  "dongguan", "shenzhen", "guangzhou", "ningbo", "yiwu", "qingdao", "shanghai", "xiamen", "tianjin", "huizhou", "wenzhou", "zhongshan", "nantong", "linyi", "jinan", "taizhou", "dongyang", "foshan", "hangzhou", "suzhou",
  "guangdong", "shandong", "zhejiang", "jiangsu", "fujian", "hebei", "henan", "hubei", "hunan", "anhui", "sichuan",
  "packaging", "trading", "industrial", "industry", "technology", "tech", "limited", "company", "products", "product", "international", "import", "export", "hardware", "plastic", "plastics",
  "manufacturing", "manufacturer", "factory", "crafts", "craft", "safety", "lighting", "culture", "metal", "steel", "structure", "garden", "electronics", "electronic", "electric", "machinery", "equipment",
  "china", "group", "development", "supply", "chain", "textile", "textiles", "furniture", "toys", "gifts", "sports", "fitness", "home", "household", "verify", "legal", "name", "quote", "unidentified",
]);
const distinctiveTokens = (n: string) => new Set(n.split(" ").filter((t) => t.length >= 5 && !GENERIC_WORDS.has(t) && !/^\d+$/.test(t)));

/**
 * Duplicate rule (SPEC F-21): same normalised name, one name containing the other, or a shared distinctive token
 * ("Dongguan Yuantuo Packaging Co Ltd" ↔ "Dongguan Yuantuo Packaging Products Co., Ltd." meet on "yuantuo").
 */
/** Pure: do two legal names denote the same factory? (exported for the unit test) */
export function isDuplicateName(a: string, b: string): boolean {
  const n = normaliseSupplierName(a), other = normaliseSupplierName(b);
  if (!n || !other) return false;
  if (other === n) return true;
  if (n.length >= 8 && other.length >= 8 && (other.includes(n) || n.includes(other))) return true;
  const mine = distinctiveTokens(n);
  for (const t of distinctiveTokens(other)) if (mine.has(t)) return true;
  return false;
}

export async function findDuplicate(db: DbOrTx, legalName: string, exceptId?: string) {
  if (!normaliseSupplierName(legalName)) return null;
  const rows = await db.select({ id: suppliers.id, ref: suppliers.ref, legalName: suppliers.legalName }).from(suppliers).where(isNull(suppliers.deletedAt));
  const hit = rows.find((r) => r.id !== exceptId && isDuplicateName(legalName, r.legalName));
  return hit ? { id: hit.id, ref: hit.ref, legalName: hit.legalName } : null;
}

const clean = (v: string | null | undefined) => { const t = v?.trim(); return t ? t : null; };

export async function createSupplier(ctx: Ctx, input: SupplierInput & { contact?: ContactInput | null; createAnyway?: boolean }): Promise<{ id: string; ref: string }> {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const db = await getDb();
  const dup = await findDuplicate(db, input.legalName);
  if (dup && !(input.createAnyway && isAdmin(ctx))) throw new DuplicateSupplier(dup);
  const ref = await nextRef(db, "SUP");
  const id = uuidv7();
  const at = now();
  await db.transaction(async (tx) => {
    await tx.insert(suppliers).values({
      id, ref, legalName: input.legalName.trim(), normalisedName: normaliseSupplierName(input.legalName), cnName: clean(input.cnName),
      typeVerdict: input.typeVerdict ?? "unchecked", verdictSource: input.verdictSource ?? null, verdictCheckedAt: input.typeVerdict && input.typeVerdict !== "unchecked" ? at : null,
      grade: input.grade ?? null, uscc: clean(input.uscc), registeredAt: clean(input.registeredAt), capital: clean(input.capital), city: clean(input.city), province: clean(input.province),
      country: clean(input.country) ?? "CN", ports: input.ports ?? [], website: clean(input.website), notes: clean(input.notes), disclosedToOrgIds: [], createdBy: ctx.userId, createdAt: at, updatedAt: at,
    });
    await tx.insert(supplierPerformance).values({ supplierId: id, ordersCount: 0, updatedAt: at });
    if (input.contact && (clean(input.contact.name) || clean(input.contact.handle))) {
      await tx.insert(supplierContacts).values({ id: uuidv7(), supplierId: id, name: clean(input.contact.name), channel: input.contact.channel, handle: clean(input.contact.handle), phone: clean(input.contact.phone), isPrimary: true, createdAt: at });
    }
    await logActivity(tx, { orgId: ctx.orgId, entityType: "supplier", entityId: id, type: "supplier_created", actorId: ctx.userId, actorName: ctx.name, visibility: "internal", at, payload: { text: `Supplier ${ref} created`, ref, legalName: input.legalName.trim(), createAnyway: !!input.createAnyway, duplicateOf: dup?.ref ?? null } });
  });
  invalidateLeakSources();
  return { id, ref };
}

export async function updateSupplier(ctx: Ctx, id: string, input: SupplierInput): Promise<{ ref: string }> {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const db = await getDb();
  const [s] = await db.select().from(suppliers).where(and(eq(suppliers.id, id), isNull(suppliers.deletedAt))).limit(1);
  if (!s) throw new NotFound("supplier");
  const dup = await findDuplicate(db, input.legalName, id);
  if (dup) throw new DuplicateSupplier(dup);
  const at = now();
  const verdictChanged = (input.typeVerdict ?? s.typeVerdict) !== s.typeVerdict || (input.verdictSource ?? null) !== s.verdictSource;
  await db.transaction(async (tx) => {
    await tx.update(suppliers).set({
      legalName: input.legalName.trim(), normalisedName: normaliseSupplierName(input.legalName), cnName: clean(input.cnName), typeVerdict: input.typeVerdict ?? s.typeVerdict, verdictSource: input.verdictSource ?? null,
      verdictCheckedAt: verdictChanged ? at : s.verdictCheckedAt, grade: input.grade ?? null, uscc: clean(input.uscc), registeredAt: clean(input.registeredAt), capital: clean(input.capital), city: clean(input.city), province: clean(input.province),
      country: clean(input.country) ?? s.country, ports: input.ports ?? s.ports, website: clean(input.website), notes: clean(input.notes), updatedAt: at,
    }).where(eq(suppliers.id, id));
    await logActivity(tx, { orgId: ctx.orgId, entityType: "supplier", entityId: id, type: "supplier_updated", actorId: ctx.userId, actorName: ctx.name, visibility: "internal", at, payload: { text: `Supplier ${s.ref} updated`, ref: s.ref, changed: Object.keys(input) } });
  });
  invalidateLeakSources();
  return { ref: s.ref };
}

export async function addContact(ctx: Ctx, supplierId: string, input: ContactInput): Promise<{ id: string }> {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const db = await getDb();
  const [s] = await db.select({ id: suppliers.id, ref: suppliers.ref }).from(suppliers).where(and(eq(suppliers.id, supplierId), isNull(suppliers.deletedAt))).limit(1);
  if (!s) throw new NotFound("supplier");
  const id = uuidv7();
  const at = now();
  await db.transaction(async (tx) => {
    if (input.isPrimary) await tx.update(supplierContacts).set({ isPrimary: false }).where(eq(supplierContacts.supplierId, supplierId));
    const existing = await tx.select({ id: supplierContacts.id }).from(supplierContacts).where(and(eq(supplierContacts.supplierId, supplierId), isNull(supplierContacts.deletedAt)));
    await tx.insert(supplierContacts).values({ id, supplierId, name: clean(input.name), channel: input.channel, handle: clean(input.handle), phone: clean(input.phone), isPrimary: input.isPrimary || existing.length === 0, createdAt: at });
    await logActivity(tx, { orgId: ctx.orgId, entityType: "supplier", entityId: supplierId, type: "contact_added", actorId: ctx.userId, actorName: ctx.name, visibility: "internal", at, payload: { text: `Contact added (${input.channel})`, ref: s.ref, channel: input.channel, name: clean(input.name), handle: clean(input.handle) } });
  });
  invalidateLeakSources();
  return { id };
}

export async function updateContact(ctx: Ctx, contactId: string, input: ContactInput): Promise<void> {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const db = await getDb();
  const [c] = await db.select().from(supplierContacts).where(and(eq(supplierContacts.id, contactId), isNull(supplierContacts.deletedAt))).limit(1);
  if (!c) throw new NotFound("contact");
  const at = now();
  await db.transaction(async (tx) => {
    if (input.isPrimary) await tx.update(supplierContacts).set({ isPrimary: false }).where(eq(supplierContacts.supplierId, c.supplierId));
    await tx.update(supplierContacts).set({ name: clean(input.name), channel: input.channel, handle: clean(input.handle), phone: clean(input.phone), isPrimary: !!input.isPrimary || c.isPrimary && input.isPrimary !== false }).where(eq(supplierContacts.id, contactId));
    await logActivity(tx, { orgId: ctx.orgId, entityType: "supplier", entityId: c.supplierId, type: "contact_updated", actorId: ctx.userId, actorName: ctx.name, visibility: "internal", at, payload: { text: `Contact updated (${input.channel})`, contactId, channel: input.channel } });
  });
  invalidateLeakSources();
}

export async function removeContact(ctx: Ctx, contactId: string): Promise<void> {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const db = await getDb();
  const [c] = await db.select().from(supplierContacts).where(and(eq(supplierContacts.id, contactId), isNull(supplierContacts.deletedAt))).limit(1);
  if (!c) throw new NotFound("contact");
  const at = now();
  await db.transaction(async (tx) => {
    await tx.update(supplierContacts).set({ deletedAt: at, isPrimary: false }).where(eq(supplierContacts.id, contactId));
    await logActivity(tx, { orgId: ctx.orgId, entityType: "supplier", entityId: c.supplierId, type: "contact_removed", actorId: ctx.userId, actorName: ctx.name, visibility: "internal", at, payload: { text: "Contact removed", contactId } });
  });
  invalidateLeakSources();
}

/** Price lists and catalogues are internal documents attached to the supplier (agency org); never publishable (SPEC F-23). */
export async function uploadSupplierDocument(
  ctx: Ctx,
  p: { supplierId: string; kind: Extract<DocumentKind, "price_list" | "catalogue">; data: Buffer; mime: string; filename: string; validUntil?: string | null; currency?: string | null; notes?: string | null },
): Promise<{ documentId: string }> {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const db = await getDb();
  const [s] = await db.select({ id: suppliers.id, ref: suppliers.ref }).from(suppliers).where(and(eq(suppliers.id, p.supplierId), isNull(suppliers.deletedAt))).limit(1);
  if (!s) throw new NotFound("supplier");
  const at = now();
  return db.transaction(async (tx) => {
    const r = await storeDocument(tx, { orgId: ctx.orgId, userId: ctx.userId, actorName: ctx.name, data: p.data, mime: p.mime, filename: p.filename, entity: "supplier", entityId: s.id, kind: p.kind, visibility: "internal", at });
    const row = { id: uuidv7(), supplierId: s.id, documentId: r.documentId, receivedAt: at, validUntil: clean(p.validUntil), currency: clean(p.currency) ?? "USD", notes: clean(p.notes), createdAt: at };
    if (p.kind === "price_list") await tx.insert(supplierPriceLists).values(row); else await tx.insert(supplierCatalogues).values(row);
    return { documentId: r.documentId };
  });
}

/** Soft delete; blocked while any participation is `selected` (SPEC F-21). */
export async function deleteSupplier(ctx: Ctx, id: string): Promise<void> {
  if (!isAdmin(ctx)) throw new Forbidden("admin only");
  const db = await getDb();
  const [sel] = await db.select({ id: supplierParticipations.id }).from(supplierParticipations).where(and(eq(supplierParticipations.supplierId, id), eq(supplierParticipations.status, "selected"), isNull(supplierParticipations.deletedAt))).limit(1);
  if (sel) throw new Forbidden("supplier is selected on a line");
  const at = now();
  await db.transaction(async (tx) => {
    await tx.update(suppliers).set({ deletedAt: at, updatedAt: at }).where(eq(suppliers.id, id));
    await logActivity(tx, { orgId: ctx.orgId, entityType: "supplier", entityId: id, type: "supplier_deleted", actorId: ctx.userId, actorName: ctx.name, visibility: "internal", at, payload: { text: "Supplier deleted" } });
  });
  invalidateLeakSources();
}
