/**
 * Extra client line facts shared by the line page and the request page (fix phase, contracts with FIX-B):
 * `milestoneDates` (first time each client milestone was reached), `specFields` (the frozen spec as raw key/value pairs —
 * the UI humanises keys through the shared label map), `offerOutcome` (QA-11), `milestoneLabel` (QA-12), `onHoldReason`.
 * App schema only.
 */
import { and, eq, inArray, or } from "drizzle-orm";
import type { DbOrTx } from "@/db";
import { activityEvents, requestLines, productSpecs } from "@/db/schema/app";
import { MILESTONES, type Milestone } from "@/db/enums";
import type { LineContext } from "@/server/shared/line-context";
import { clientMilestoneLabel } from "@/server/shared/labels";

export type MilestoneDate = { milestone: Milestone; at: string };
export type SpecField = { key: string; value: string | number | boolean };

/** Pure: first time each milestone was reached, from client-visible events (ascending or not), capped at the current milestone. */
export function firstMilestoneDates(events: { type: string; payload: Record<string, unknown>; createdAt: Date }[], createdAt: Date, current: Milestone): MilestoneDate[] {
  const first = new Map<Milestone, Date>([["received", createdAt]]);
  for (const e of [...events].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
    const m = (e.type === "order_confirmed" ? "order_confirmed" : e.payload.milestone) as Milestone | undefined;
    if (!m || !(MILESTONES as readonly string[]).includes(m)) continue;
    if (e.type !== "state_changed" && e.type !== "state_overridden" && e.type !== "order_confirmed") continue;
    if (!first.has(m)) first.set(m, e.createdAt);
  }
  const cap = MILESTONES.indexOf(current);
  return MILESTONES.filter((m, i) => i <= cap && first.has(m)).map((m) => ({ milestone: m, at: first.get(m)!.toISOString() }));
}

export async function milestoneDatesFor(db: DbOrTx, orgId: string, lcs: LineContext[]): Promise<Map<string, MilestoneDate[]>> {
  const out = new Map<string, MilestoneDate[]>();
  if (!lcs.length) return out;
  const lineIds = lcs.map((l) => l.id);
  const orderIds = [...new Set(lcs.map((l) => l.order?.id).filter((x): x is string => !!x))];
  const conds = [and(eq(activityEvents.entityType, "request_line"), inArray(activityEvents.entityId, lineIds))];
  if (orderIds.length) conds.push(and(eq(activityEvents.entityType, "order"), inArray(activityEvents.entityId, orderIds)));
  const rows = await db.select({ entityId: activityEvents.entityId, type: activityEvents.type, payload: activityEvents.payload, createdAt: activityEvents.createdAt }).from(activityEvents)
    .where(and(eq(activityEvents.orgId, orgId), eq(activityEvents.visibility, "client"), inArray(activityEvents.type, ["state_changed", "state_overridden", "order_confirmed"]), or(...conds)));
  for (const lc of lcs) {
    const evs = rows.filter((r) => r.entityId === lc.id || (lc.order && r.entityId === lc.order.id));
    out.set(lc.id, firstMilestoneDates(evs, lc.createdAt, lc.milestone));
  }
  return out;
}

export async function specFieldsFor(db: DbOrTx, lineIds: string[]): Promise<Map<string, SpecField[]>> {
  const out = new Map<string, SpecField[]>();
  if (!lineIds.length) return out;
  const lines = await db.select({ id: requestLines.id, productId: requestLines.productId, specVersion: requestLines.specVersion }).from(requestLines).where(inArray(requestLines.id, lineIds));
  const productIds = [...new Set(lines.map((l) => l.productId).filter((x): x is string => !!x))];
  const specs = productIds.length ? await db.select({ productId: productSpecs.productId, version: productSpecs.version, fields: productSpecs.fields, frozenAt: productSpecs.frozenAt }).from(productSpecs).where(inArray(productSpecs.productId, productIds)) : [];
  for (const l of lines) {
    const s = l.productId && l.specVersion ? specs.find((x) => x.productId === l.productId && x.version === l.specVersion && x.frozenAt) : null;
    out.set(l.id, s ? Object.entries(s.fields).map(([key, value]) => ({ key, value })) : []);
  }
  return out;
}

/** QA-11: the latest offer's outcome while we owe the client a new version (line still in offer_ready). */
export function offerOutcomeOf(lc: Pick<LineContext, "state" | "offer">): "changes_requested" | "declined" | "expired" | null {
  if (lc.state !== "offer_ready" || !lc.offer) return null;
  return lc.offer.status === "changes_requested" || lc.offer.status === "declined" || lc.offer.status === "expired" ? lc.offer.status : null;
}

export function lineExtras(lc: LineContext, dates: Map<string, MilestoneDate[]>, specs: Map<string, SpecField[]>) {
  return {
    milestoneLabel: clientMilestoneLabel(lc.state, lc.milestone),
    milestoneDates: dates.get(lc.id) ?? [],
    specFields: specs.get(lc.id) ?? [],
    offerOutcome: offerOutcomeOf(lc),
    onHoldReason: lc.exception === "on_hold" ? lc.exceptionReason : null,
  };
}
