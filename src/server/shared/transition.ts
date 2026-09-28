/**
 * `transition()` — the ONLY way to change `state` on a line or an order (SPEC §3.1). In one transaction:
 * lock the row, assert the table (§3.4), write state + milestone (always via milestoneFor) + last_state_change_at,
 * mirror order → lines, log `state_changed`, enqueue `client_milestone_changed` / `ops_new_request` (unless suppressed).
 * Callers that fire a more specific client template (offer ready, payment due, …) pass `notifyClient: false` (SPEC N-05).
 */
import { eq, inArray } from "drizzle-orm";
import { getDb, type DbOrTx, type Tx } from "@/db";
import { requestLines, orders, orderLines, requests, organizations } from "@/db/schema/app";
import { assertTransition, milestoneChanged, milestoneFor, isFeedState, type State, type Milestone } from "./state-machine";
import { logActivity } from "./activity";
import { enqueue } from "./outbox";
import { clientUsersOf, opsUsers } from "./users";
import { milestoneEmailSubject } from "./labels";
import { now } from "./clock";
import type { Ctx } from "./authorize";

export type TransitionOpts = {
  /** Client-safe note stored in the event payload and shown in the client feed (caller leak-checks it). */
  note?: string;
  /** Extra client-safe payload fields (e.g. { eta: "2026-10-25" }). */
  payload?: Record<string, unknown>;
  /** Set false when a more specific client template is enqueued in the same action (N-05 exception). */
  notifyClient?: boolean;
  /** Admin override: bypass the transition table; writes `state_overridden` with the mandatory reason. */
  override?: { reason: string };
  /** Timestamp to use instead of now() (seeding). */
  at?: Date;
  /** Run inside an existing transaction. */
  tx?: Tx;
  /** Also clear the exception (e.g. change_requested resolved by reopening). */
  clearException?: boolean;
};

export type TransitionResult = { from: State; to: State; milestone: Milestone | null; eventId: string };

function actor(ctx: Ctx | null) {
  return { actorId: ctx?.userId ?? null, actorName: ctx?.name ?? "System" };
}

async function inTx<T>(tx: Tx | undefined, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (tx) return fn(tx);
  const db = await getDb();
  return db.transaction(fn as never) as Promise<T>;
}

/** Line transition (before an order exists). */
export async function transition(lineId: string, to: State, ctx: Ctx | null, opts: TransitionOpts = {}): Promise<TransitionResult> {
  return inTx(opts.tx, async (tx) => {
    const [line] = await tx.select().from(requestLines).where(eq(requestLines.id, lineId)).for("update");
    if (!line) throw new Error(`line ${lineId} not found`);
    const from = line.state as State;
    if (!opts.override) assertTransition(from, to);
    const at = opts.at ?? now();
    const milestone = milestoneFor(to);
    const changed = milestoneChanged(from, to);
    await tx
      .update(requestLines)
      .set({ state: to, milestone, lastStateChangeAt: at, updatedAt: at, staleSince: null, ...(opts.clearException ? { exception: null, exceptionReason: null } : {}) })
      .where(eq(requestLines.id, lineId));
    // request header roll-up (SPEC 3.6 request_status)
    if (to === "submitted") await tx.update(requests).set({ status: "submitted", submittedAt: at, updatedAt: at }).where(eq(requests.id, line.requestId));
    else if (from === "submitted" || from === "in_review") await tx.update(requests).set({ status: "active", updatedAt: at }).where(eq(requests.id, line.requestId));
    const eventId = await logActivity(tx, {
      orgId: line.orgId, entityType: "request_line", entityId: lineId, type: opts.override ? "state_overridden" : "state_changed",
      ...actor(ctx), visibility: "client", at,
      payload: { ref: line.lineRef, from, to, milestone, milestoneChanged: changed !== null, feed: isFeedState(to), note: opts.note ?? null, ...(opts.payload ?? {}), ...(opts.override ? { reason: opts.override.reason } : {}) },
    });
    await notify(tx, { orgId: line.orgId, entityId: lineId, entityRef: line.lineRef, name: line.name, to, changed, at, notifyClient: opts.notifyClient, assignedAgentId: line.assignedAgentId, url: `/app/lines/${line.lineRef}` });
    return { from, to, milestone: changed, eventId };
  });
}

/** Order transition — mirrored to every order line's request line (SPEC §3.1). */
export async function transitionOrder(orderId: string, to: State, ctx: Ctx | null, opts: TransitionOpts = {}): Promise<TransitionResult> {
  return inTx(opts.tx, async (tx) => {
    const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for("update");
    if (!order) throw new Error(`order ${orderId} not found`);
    const from = order.state as State;
    if (!opts.override) assertTransition(from, to);
    const at = opts.at ?? now();
    const milestone = milestoneFor(to);
    const changed = milestoneChanged(from, to);
    const patch = { state: to, milestone, lastStateChangeAt: at, updatedAt: at, staleSince: null as Date | null, ...(opts.clearException ? { exception: null, exceptionReason: null } : {}) };
    await tx.update(orders).set({ ...patch, ...(to === "delivered" ? { deliveredAt: at } : {}), ...(to === "completed" ? { completedAt: at } : {}) }).where(eq(orders.id, orderId));
    const ol = await tx.select({ requestLineId: orderLines.requestLineId }).from(orderLines).where(eq(orderLines.orderId, orderId));
    const lineIds = ol.map((r) => r.requestLineId);
    if (lineIds.length) await tx.update(requestLines).set(patch).where(inArray(requestLines.id, lineIds));
    if (to === "completed") await tx.update(requests).set({ status: "closed", updatedAt: at }).where(eq(requests.id, order.requestId));
    const eventId = await logActivity(tx, {
      orgId: order.orgId, entityType: "order", entityId: orderId, type: opts.override ? "state_overridden" : "state_changed",
      ...actor(ctx), visibility: "client", at,
      payload: { ref: order.ref, from, to, milestone, milestoneChanged: changed !== null, feed: isFeedState(to), note: opts.note ?? null, ...(opts.payload ?? {}), ...(opts.override ? { reason: opts.override.reason } : {}) },
    });
    await notify(tx, { orgId: order.orgId, entityId: orderId, entityRef: order.ref, name: order.ref, to, changed, at, notifyClient: opts.notifyClient, assignedAgentId: order.assignedAgentId, url: `/app/orders/${order.ref}` });
    return { from, to, milestone: changed, eventId };
  });
}

async function notify(tx: DbOrTx, p: { orgId: string; entityId: string; entityRef: string; name: string; to: State; changed: Milestone | null; at: Date; notifyClient?: boolean; assignedAgentId: string | null; url: string }) {
  if (p.changed && p.notifyClient !== false) {
    for (const u of await clientUsersOf(tx, p.orgId)) {
      await enqueue({
        userId: u.id, toEmail: u.email, template: "client_milestone_changed", entityRef: p.entityRef,
        subject: milestoneEmailSubject(p.name, p.to, p.changed),
        payload: { ref: p.entityRef, name: p.name, milestone: p.changed, state: p.to, text: p.to === "offer_accepted" ? "We're preparing your order confirmation" : undefined, url: p.url },
        idempotencyKey: `client_milestone_changed:${p.entityId}:${p.changed}:${p.at.toISOString()}:${u.id}`, at: p.at,
      }, tx);
    }
  }
  if (p.to === "submitted") {
    const recipients = await opsUsers(tx);
    const [org] = await tx.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, p.orgId)).limit(1); // QA-40: say who it is from
    for (const u of recipients) {
      await enqueue({
        userId: u.id, toEmail: u.email, template: "ops_new_request", entityRef: p.entityRef,
        subject: `New request ${p.entityRef}${org?.name ? ` from ${org.name}` : ""} — ${p.name}`,
        payload: { ref: p.entityRef, name: p.name, url: `/ops/lines/${p.entityRef}` },
        idempotencyKey: `ops_new_request:${p.entityId}:${u.id}`, at: p.at,
      }, tx);
    }
  }
}

/** Sets or clears the exception flag (SPEC §3.5) without touching the state. */
export async function setException(
  target: { lineId: string } | { orderId: string },
  exception: (typeof requestLines.$inferSelect)["exception"],
  ctx: Ctx | null,
  opts: { reason?: string; at?: Date; tx?: Tx } = {},
) {
  return inTx(opts.tx, async (tx) => {
    const at = opts.at ?? now();
    const isLine = "lineId" in target;
    const table = isLine ? requestLines : orders;
    const id = isLine ? target.lineId : target.orderId;
    const [row] = await tx.select({ orgId: table.orgId, ref: isLine ? requestLines.lineRef : orders.ref }).from(table).where(eq(table.id, id)).limit(1);
    if (!row) throw new Error("entity not found");
    await tx.update(table).set({ exception, exceptionReason: opts.reason ?? null, updatedAt: at }).where(eq(table.id, id));
    const clientVisible = exception === null || ["needs_input", "on_hold", "cancelled"].includes(exception);
    await logActivity(tx, {
      orgId: row.orgId, entityType: isLine ? "request_line" : "order", entityId: id, type: exception ? "exception_set" : "exception_cleared",
      ...actor(ctx), visibility: clientVisible ? "client" : "internal", at, payload: { ref: row.ref, exception, reason: opts.reason ?? null },
    });
  });
}
