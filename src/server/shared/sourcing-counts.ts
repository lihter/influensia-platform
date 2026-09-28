/**
 * The ONLY sourcing facts a client may learn: how many factories were reached and how many priced (SPEC 5.3).
 * Reads the supplier schema, returns plain numbers keyed by line id — nothing supplier-shaped crosses this boundary.
 */
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db";
import { supplierParticipations, quotes } from "@/db/schema/supplier";
import type { ParticipationStatus } from "@/db/enums";
import { sourcingProgress } from "./compare";

export async function sourcingCounts(db: DbOrTx, lineIds: string[]): Promise<Record<string, { reached: number; priced: number }>> {
  const out: Record<string, { reached: number; priced: number }> = {};
  for (const id of lineIds) out[id] = { reached: 0, priced: 0 };
  if (!lineIds.length) return out;
  const rows = await db
    .select({ id: supplierParticipations.id, lineId: supplierParticipations.requestLineId, status: supplierParticipations.status })
    .from(supplierParticipations)
    .where(and(inArray(supplierParticipations.requestLineId, lineIds), isNull(supplierParticipations.deletedAt)));
  const quoted = rows.length
    ? await db.select({ participationId: quotes.participationId, n: sql<number>`count(*)` }).from(quotes).where(inArray(quotes.participationId, rows.map((r) => r.id))).groupBy(quotes.participationId)
    : [];
  const hasQuote = new Set(quoted.filter((q) => Number(q.n) > 0).map((q) => q.participationId));
  const byLine = new Map<string, { status: ParticipationStatus; hasQuote: boolean }[]>();
  for (const r of rows) {
    const arr = byLine.get(r.lineId) ?? [];
    arr.push({ status: r.status as ParticipationStatus, hasQuote: hasQuote.has(r.id) });
    byLine.set(r.lineId, arr);
  }
  for (const [lineId, parts] of byLine) out[lineId] = sourcingProgress(parts);
  return out;
}

/** Whether a published factory range exists for (selected supplier of line × org). Returns the label or null. */
export async function factoryLabelForLine(db: DbOrTx, p: { lineId: string; orgId: string }): Promise<string | null> {
  const { requestLines, factoryRanges } = await import("@/db/schema/app");
  const [line] = await db.select({ sel: requestLines.selectedParticipationId }).from(requestLines).where(eq(requestLines.id, p.lineId)).limit(1);
  if (!line?.sel) return null;
  const [part] = await db.select({ supplierId: supplierParticipations.supplierId }).from(supplierParticipations).where(eq(supplierParticipations.id, line.sel)).limit(1);
  if (!part) return null;
  const [range] = await db
    .select({ label: factoryRanges.label })
    .from(factoryRanges)
    .where(and(eq(factoryRanges.orgId, p.orgId), eq(factoryRanges.supplierId, part.supplierId as never), isNull(factoryRanges.deletedAt)))
    .limit(1);
  return range?.label && range.label ? range.label : null;
}
