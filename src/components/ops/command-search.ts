"use server";
/**
 * ⌘K palette search (QA-21 / UX #9). Ops-only; read-only; returns at most 8 hits per group.
 * Matches refs (REQ-2026-0312, 0312-02, ORD-…, PRD-…, SUP-7, FR-…) and names (line, product, supplier legal/CN, client).
 */
import { and, desc, ilike, isNull, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { organizations, products, requestLines, requests, orders, factoryRanges } from "@/db/schema/app";
import { suppliers } from "@/db/schema/supplier";
import { authorizeOps } from "@/server/shared/authorize";

export type SearchHit = { group: "Lines" | "Requests" | "Orders" | "Suppliers" | "Products" | "Clients" | "Factory ranges"; ref: string; title: string; sub?: string; href: string };

export async function opsSearch(q: string): Promise<SearchHit[]> {
  await authorizeOps();
  const query = q.trim();
  if (query.length < 2) return [];
  const db = await getDb();
  // "SUP-7" → "SUP-0007"; "0312-02" matches line refs by substring.
  const supNum = query.match(/^sup-?0*(\d+)$/i);
  const like = `%${query.replace(/[%_]/g, "")}%`;
  const supLike = supNum ? `%SUP-${supNum[1].padStart(4, "0")}%` : like;
  const LIM = 8;

  const [lines, reqs, ords, sups, prods, orgs, ranges] = await Promise.all([
    db.select({ ref: requestLines.lineRef, name: requestLines.name, state: requestLines.state }).from(requestLines)
      .where(and(isNull(requestLines.deletedAt), or(ilike(requestLines.lineRef, like), ilike(requestLines.name, like)))).orderBy(desc(requestLines.lineRef)).limit(LIM),
    db.select({ ref: requests.ref, org: organizations.name, id: requests.id }).from(requests).innerJoin(organizations, sql`${organizations.id} = ${requests.orgId}`)
      .where(and(isNull(requests.deletedAt), or(ilike(requests.ref, like), ilike(requests.clientRef, like), ilike(organizations.name, like)))).orderBy(desc(requests.ref)).limit(LIM),
    db.select({ ref: orders.ref, org: organizations.name }).from(orders).innerJoin(organizations, sql`${organizations.id} = ${orders.orgId}`)
      .where(and(isNull(orders.deletedAt), or(ilike(orders.ref, like), ilike(organizations.name, like)))).orderBy(desc(orders.ref)).limit(LIM),
    db.select({ ref: suppliers.ref, name: suppliers.legalName, cn: suppliers.cnName }).from(suppliers)
      .where(and(isNull(suppliers.deletedAt), or(ilike(suppliers.ref, supLike), ilike(suppliers.legalName, like), ilike(suppliers.cnName, like)))).orderBy(suppliers.ref).limit(LIM),
    db.select({ ref: products.ref, name: products.name }).from(products)
      .where(and(isNull(products.deletedAt), or(ilike(products.ref, like), ilike(products.name, like)))).orderBy(products.ref).limit(LIM),
    db.select({ id: organizations.id, name: organizations.name }).from(organizations)
      .where(and(isNull(organizations.deletedAt), sql`${organizations.type} = 'client'`, ilike(organizations.name, like))).orderBy(organizations.name).limit(LIM),
    db.select({ ref: factoryRanges.ref, label: factoryRanges.label }).from(factoryRanges)
      .where(and(isNull(factoryRanges.deletedAt), or(ilike(factoryRanges.ref, like), ilike(factoryRanges.label, like)))).orderBy(factoryRanges.ref).limit(LIM),
  ]);

  return [
    ...lines.map((l) => ({ group: "Lines" as const, ref: l.ref, title: l.name, href: `/ops/lines/${l.ref}` })),
    ...reqs.map((r) => ({ group: "Requests" as const, ref: r.ref, title: r.org, href: `/ops/requests/${r.ref}` })),
    ...ords.map((o) => ({ group: "Orders" as const, ref: o.ref, title: o.org, href: `/ops/orders/${o.ref}` })),
    ...sups.map((s) => ({ group: "Suppliers" as const, ref: s.ref, title: s.name, sub: s.cn ?? undefined, href: `/ops/suppliers/${s.ref}` })),
    ...prods.map((p) => ({ group: "Products" as const, ref: p.ref, title: p.name, href: `/ops/products/${p.ref}` })),
    ...orgs.map((o) => ({ group: "Clients" as const, ref: "", title: o.name, href: `/ops/clients/${o.id}` })),
    ...ranges.map((r) => ({ group: "Factory ranges" as const, ref: r.ref, title: r.label ? `Factory ${r.label}` : "Draft range", href: `/ops/factory-ranges/${r.ref}` })),
  ];
}
