/**
 * Client dashboard (SPEC F-03). Reads app schema only; sourcing counts come from the shared count helper as numbers.
 * Everything returned passes through a `.strict()` client DTO.
 */
import { and, desc, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { organizations, users, comments, activityEvents } from "@/db/schema/app";
import { type Ctx, isClient, Forbidden } from "@/server/shared/authorize";
import { loadLineContexts, type LineContext } from "@/server/shared/line-context";
import { milestoneStep, isActionMilestone, MILESTONES } from "@/server/shared/state-machine";
import { subLabelFor, exceptionClientText, eventText, isFeedEvent } from "@/server/shared/labels";
import { formatDate } from "@/server/shared/dates";
import { ClientDashboardDto, ClientWaitingItemDto, ClientActiveLineDto, ClientUpdateDto, type WaitingReasonDto } from "./dto";

const CLIENT_REASONS = new Set(["needs_input", "offer_sent", "sample_received", "deposit_due", "artwork_due", "balance_due", "delivery_confirm"]);

export function clientWaitingReason(lc: LineContext): WaitingReasonDto | null {
  return lc.waiting.party === "client" && CLIENT_REASONS.has(lc.waiting.reason) ? (lc.waiting.reason as WaitingReasonDto) : null;
}

export function etaLabelFor(lc: LineContext): string | null {
  if (!lc.order) return null;
  if (lc.order.deliveredAt) return `Delivered ${formatDate(lc.order.deliveredAt)}`;
  if (lc.order.etaPort) return `ETA ${lc.order.portOfDischarge ?? "port"} ${formatDate(lc.order.etaPort)}`;
  if (lc.order.exworksEta) return `Ex-works ETA ${formatDate(lc.order.exworksEta)}`;
  return null;
}

/** Builds the "Waiting on you" items from line contexts, one card per order for order-level reasons (SPEC F-03). */
export function waitingItems(lcs: LineContext[]): ClientWaitingItemDto[] {
  const items: ClientWaitingItemDto[] = [];
  const seenOrders = new Set<string>();
  for (const lc of lcs) {
    const reason = clientWaitingReason(lc);
    if (!reason) continue;
    const orderLevel = ["deposit_due", "artwork_due", "balance_due", "delivery_confirm"].includes(reason) && lc.order;
    if (orderLevel && lc.order) {
      if (seenOrders.has(lc.order.id)) continue;
      seenOrders.add(lc.order.id);
      const pays = lc.order.payments;
      const pick = (k: string) => pays.find((p) => p.kind === k && p.status === "pending");
      const amounts = reason === "deposit_due" ? [pick("deposit"), pick("fee")].filter((x): x is NonNullable<typeof x> => !!x).map((p) => ({ minor: p.amountMinor, currency: p.currency }))
        : reason === "balance_due" ? [pick("balance")].filter((x): x is NonNullable<typeof x> => !!x).map((p) => ({ minor: p.amountMinor, currency: p.currency })) : [];
      const dueOn = reason === "deposit_due" ? pick("deposit")?.dueOn ?? null : reason === "balance_due" ? pick("balance")?.dueOn ?? null : null;
      const anchor = reason === "deposit_due" ? "#payments" : reason === "artwork_due" ? "#artwork" : reason === "balance_due" ? "#qc" : "";
      items.push(ClientWaitingItemDto.parse({
        id: `${reason}:${lc.order.ref}`, reason, entityRef: lc.order.ref, name: lc.name, href: `/app/orders/${lc.order.ref}${anchor}`, dueOn, amounts,
        questionExcerpt: null, artworkChangesRequested: lc.waiting.detail === "artwork_changes_requested", since: lc.order.lastStateChangeAt.toISOString(),
      }));
    } else {
      const href = reason === "offer_sent" && lc.offer ? `/app/offers/${lc.offer.ref}` : reason === "sample_received" && lc.sample ? `/app/samples/${lc.sample.ref}` : `/app/lines/${lc.ref}${reason === "needs_input" ? "#ask" : ""}`;
      items.push(ClientWaitingItemDto.parse({
        id: `${reason}:${lc.ref}`, reason, entityRef: lc.ref, name: lc.name, href, dueOn: reason === "offer_sent" ? lc.offer?.validUntil ?? null : null, amounts: [],
        questionExcerpt: reason === "needs_input" ? lc.openQuestion : null, artworkChangesRequested: false, since: lc.lastStateChangeAt.toISOString(),
      }));
    }
  }
  return items.sort((a, b) => (a.dueOn ?? "9999").localeCompare(b.dueOn ?? "9999") || a.since.localeCompare(b.since));
}

export function activeLine(lc: LineContext): ClientActiveLineDto {
  return ClientActiveLineDto.parse({
    id: lc.id, ref: lc.ref, href: lc.order ? `/app/orders/${lc.order.ref}` : `/app/lines/${lc.ref}`, name: lc.name, qty: lc.qty, unit: lc.unit,
    milestone: lc.milestone, milestoneStep: milestoneStep(lc.milestone),
    subLabel: subLabelFor(lc.state, { agentName: lc.agentName, reached: lc.sourcing.reached, priced: lc.sourcing.priced, isRepeat: lc.isRepeat }),
    exception: lc.exception, exceptionText: exceptionClientText(lc.exception), waitingReason: clientWaitingReason(lc),
    sourcingProgress: lc.sourcing, etaLabel: etaLabelFor(lc), orderRef: lc.order?.ref ?? null, isRepeat: lc.isRepeat, updatedAt: lc.updatedAt.toISOString(),
  });
}

export async function getClientDashboard(ctx: Ctx): Promise<ClientDashboardDto> {
  if (!isClient(ctx)) throw new Forbidden("clients only");
  const db = await getDb();
  const [org] = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, ctx.orgId)).limit(1);
  const [me] = await db.select({ name: users.name }).from(users).where(eq(users.id, ctx.userId)).limit(1);
  const lcs = await loadLineContexts(db, { orgId: ctx.orgId });
  const active = lcs.filter((l) => l.milestone !== "delivered").sort((a, b) => MILESTONES.indexOf(a.milestone) - MILESTONES.indexOf(b.milestone) || a.ref.localeCompare(b.ref));
  const deliveredCount = new Set(lcs.filter((l) => l.milestone === "delivered").map((l) => l.order?.ref ?? l.ref)).size;

  // Recent updates: last 5 client-visible comments + milestone events across the org
  const [cRows, eRows] = await Promise.all([
    db.select().from(comments).where(and(eq(comments.orgId, ctx.orgId), eq(comments.visibility, "client"), isNull(comments.deletedAt))).orderBy(desc(comments.createdAt)).limit(10),
    db.select().from(activityEvents).where(and(eq(activityEvents.orgId, ctx.orgId), eq(activityEvents.visibility, "client"))).orderBy(desc(activityEvents.createdAt)).limit(60),
  ]);
  const orgUserIds = new Set((await db.select({ id: users.id }).from(users).where(eq(users.orgId, ctx.orgId))).map((u) => u.id));
  const recent = [
    ...cRows.map((c) => ClientUpdateDto.parse({ id: c.id, kind: "comment", at: c.createdAt.toISOString(), text: c.body, authorName: c.authorName, byYou: !!c.authorId && orgUserIds.has(c.authorId), isActionMilestone: false, attachments: [] })),
    ...eRows.filter((e) => isFeedEvent(e.type, e.payload)).map((e) => ClientUpdateDto.parse({ id: e.id, kind: "event", at: e.createdAt.toISOString(), text: eventText(e.type, e.payload), authorName: e.actorName, byYou: !!e.actorId && orgUserIds.has(e.actorId), isActionMilestone: typeof e.payload.milestone === "string" && isActionMilestone(e.payload.milestone as never) && e.payload.milestoneChanged === true, attachments: [] })),
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 5);

  return ClientDashboardDto.parse({
    companyLabel: org?.name ?? "",
    userName: me?.name ?? ctx.name,
    waiting: waitingItems(lcs),
    active: active.map(activeLine),
    deliveredCount,
    recentUpdates: recent,
  });
}
