/**
 * Ops dashboard (SPEC F-13): Stale · Waiting on us · Waiting on client · Unassigned across all client orgs.
 * Order-level rows are deduped by order (the order owns the state once it exists).
 */
import { getDb } from "@/db";
import { type Ctx, isOps, Forbidden } from "@/server/shared/authorize";
import { loadLineContexts, type LineContext } from "@/server/shared/line-context";
import { daysBetween } from "@/server/shared/dates";
import type { LineState, LineException } from "@/db/enums";
import type { WaitingReason } from "@/server/shared/derived";

export type OpsRow = {
  key: string;
  kind: "line" | "order";
  ref: string;
  href: string;
  name: string;
  orgName: string;
  state: LineState;
  exception: LineException | null;
  lastChangeAt: string;
  daysSinceChange: number;
  agentName: string | null;
  agentId: string | null;
  reason: WaitingReason;
  stale: boolean;
  qty: number | null;
  unit: string;
  lineId: string;
  submittedAt: string;
};

export type OpsDashboard = {
  stale: OpsRow[];
  waitingUs: OpsRow[];
  waitingClient: OpsRow[];
  unassigned: OpsRow[];
  counts: { stale: number; waitingUs: number; waitingClient: number; unassigned: number };
};

function toRow(lc: LineContext): OpsRow {
  const isOrder = !!lc.order;
  const ref = isOrder ? lc.order!.ref : lc.ref;
  const tab = lc.state === "negotiating" || lc.state === "quotes_in" || lc.state === "shortlisted" || lc.state === "rfq_out" ? "sourcing" : lc.state === "offer_ready" ? "offer" : lc.state === "spec_frozen" || lc.state === "submitted" || lc.state === "in_review" ? "spec" : "timeline";
  return {
    key: `${isOrder ? "order" : "line"}:${ref}`,
    kind: isOrder ? "order" : "line",
    ref,
    href: isOrder ? `/ops/orders/${ref}` : `/ops/lines/${ref}?tab=${tab}`,
    name: lc.name,
    orgName: lc.orgName,
    state: lc.state,
    exception: lc.exception,
    // QA-29: a needs_input row is "since" the question, not the last state change
    lastChangeAt: (lc.exception === "needs_input" && lc.openQuestionAt ? lc.openQuestionAt : lc.lastStateChangeAt).toISOString(),
    daysSinceChange: daysBetween(lc.exception === "needs_input" && lc.openQuestionAt ? lc.openQuestionAt : lc.lastStateChangeAt),
    agentName: lc.agentName,
    agentId: lc.assignedAgentId,
    reason: lc.waiting.reason,
    stale: lc.stale,
    qty: lc.qty,
    unit: lc.unit,
    lineId: lc.id,
    submittedAt: lc.createdAt.toISOString(),
  };
}

/** QA-10: any open line without an owner — not only `submitted` (range/catalog lines start further along). */
export const isUnassigned = (r: { agentId: string | null; state: LineState; kind?: "line" | "order" }) => !r.agentId && r.state !== "draft" && r.state !== "completed" && r.state !== "delivered";

export async function getOpsDashboard(ctx: Ctx, opts?: { mine?: boolean }): Promise<OpsDashboard> {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const db = await getDb();
  const lcs = await loadLineContexts(db, {});
  const seen = new Set<string>();
  const rows: OpsRow[] = [];
  for (const lc of lcs) {
    if (lc.exception === "on_hold" || lc.exception === "cancelled") continue;
    const r = toRow(lc);
    if (seen.has(r.key)) continue;
    seen.add(r.key);
    if (opts?.mine && r.agentId && r.agentId !== ctx.userId) continue;
    // unassigned rows stay visible to everyone (they are listed under Unassigned only, QA-10/QA-29)
    rows.push(r);
  }
  const stale = rows.filter((r) => r.stale).sort((a, b) => a.lastChangeAt.localeCompare(b.lastChangeAt));
  const waitingUs = rows.filter((r) => !!r.agentId && !r.stale && lcs.find((l) => l.id === r.lineId)?.waiting.party === "agency").sort((a, b) => a.lastChangeAt.localeCompare(b.lastChangeAt));
  const waitingClient = rows.filter((r) => lcs.find((l) => l.id === r.lineId)?.waiting.party === "client").sort((a, b) => a.lastChangeAt.localeCompare(b.lastChangeAt));
  const unassigned = rows.filter((r) => isUnassigned(r));
  return { stale, waitingUs, waitingClient, unassigned, counts: { stale: stale.length, waitingUs: waitingUs.length, waitingClient: waitingClient.length, unassigned: unassigned.length } };
}
