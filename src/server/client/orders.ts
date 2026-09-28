/**
 * Client order page (SPEC F-10) + the client's order actions: confirm delivery, upload artwork, ask, reorder (F-12 minimal).
 * App schema only. Every returned shape passes a `.strict()` client DTO; the supplier-derived facts (ex-works ETA,
 * factory label) come from the shared helpers as dates / a label.
 */
import { recordSupplierPerformance } from "@/server/shared/supplier-performance";
import { and, asc, desc, eq, inArray, isNull, ne, or } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { getDb, type DbOrTx } from "@/db";
import { orders, orderLines, requestLines, requests, organizations, users, payments, artworks, inspections, shipments, samples, comments, activityEvents, products } from "@/db/schema/app";
import { type Ctx, isClient, Forbidden, NotFound } from "@/server/shared/authorize";
import { loadLineContexts } from "@/server/shared/line-context";
import { milestoneStep, isActionMilestone, type Milestone } from "@/server/shared/state-machine";
import { subLabelFor, exceptionClientText, eventText, isFeedEvent, MILESTONE_EVENT_TYPES } from "@/server/shared/labels";
import { transition, transitionOrder } from "@/server/shared/transition";
import { logActivity } from "@/server/shared/activity";
import { enqueue } from "@/server/shared/outbox";
import { storeDocument } from "@/server/shared/files";
import { loadLeakSources } from "@/server/shared/leak-check";
import { factoryLabelForLine } from "@/server/shared/sourcing-counts";
import { opsUsers, clientUsersOf } from "@/server/shared/users";
import { nextRef, lineRef as mkLineRef } from "@/server/shared/ids";
import { formatDate } from "@/server/shared/dates";
import { now } from "@/server/shared/clock";
import { clientWaitingReason, etaLabelFor } from "./dashboard";
import { clientDocumentsFor, clientDocumentById, clientDocumentByFileId } from "./documents";
import { ClientOrderDto, ClientPaymentDto, ClientArtworkDto, ClientInspectionDto, ClientShipmentDto, ClientOrderLineDto, ClientPreviousOrderDto, ClientUpdateDto, ClientEventDto } from "./dto";
import { ClientOrderPageDto, ClientReorderResultDto } from "./dto/orders";

/** Client-side preconditions surfaced as `{ ok: false, error: code }`. */
export class ClientOrderError extends Error {
  status = 409;
  constructor(public code: "E_NOT_DELIVERED" | "E_NOT_REORDERABLE" | "E_NO_LINES") { super(code); }
}

/* ═══════════════════════════ read ═══════════════════════════ */

export async function getClientOrder(ctx: Ctx, ref: string): Promise<ClientOrderPageDto> {
  if (!isClient(ctx)) throw new Forbidden("clients only");
  return loadClientOrderPage(await getDb(), ctx.orgId, ref);
}

/** Org-scoped loader (also used by the ops "Preview as client" route, which passes the order's org explicitly). */
export async function loadClientOrderPage(db: DbOrTx, orgId: string, ref: string): Promise<ClientOrderPageDto> {
  const [row] = await db.select({ o: orders, requestRef: requests.ref, orgName: organizations.name }).from(orders).innerJoin(requests, eq(requests.id, orders.requestId)).innerJoin(organizations, eq(organizations.id, orders.orgId)).where(and(eq(orders.ref, ref), eq(orders.orgId, orgId), isNull(orders.deletedAt))).limit(1);
  if (!row) throw new NotFound("order");
  const o = row.o;
  const olRows = await db.select({ ol: orderLines, line: requestLines }).from(orderLines).innerJoin(requestLines, eq(requestLines.id, orderLines.requestLineId)).where(eq(orderLines.orderId, o.id)).orderBy(asc(orderLines.lineNo));
  const lineIds = olRows.map((r) => r.line.id);
  const lcs = await loadLineContexts(db, { orgId, lineIds, includeCancelled: true });
  const lc = lcs[0] ?? null;

  const [payRows, artRows, inspRows, shipRows, sampleRows, orgUsers] = await Promise.all([
    db.select().from(payments).where(and(eq(payments.orderId, o.id), isNull(payments.deletedAt))).orderBy(asc(payments.createdAt)),
    olRows.length ? db.select().from(artworks).where(and(inArray(artworks.orderLineId, olRows.map((r) => r.ol.id)), isNull(artworks.deletedAt))).orderBy(desc(artworks.version)) : Promise.resolve([]),
    db.select().from(inspections).where(and(eq(inspections.orderId, o.id), isNull(inspections.deletedAt))).orderBy(desc(inspections.createdAt)).limit(1),
    db.select().from(shipments).where(and(eq(shipments.orderId, o.id), isNull(shipments.deletedAt))).orderBy(desc(shipments.createdAt)).limit(1),
    lineIds.length ? db.select({ id: samples.id }).from(samples).where(and(inArray(samples.requestLineId, lineIds), isNull(samples.deletedAt))) : Promise.resolve([]),
    db.select({ id: users.id }).from(users).where(eq(users.orgId, orgId)),
  ]);
  const orgUserIds = new Set(orgUsers.map((u) => u.id));

  const lines = olRows.map(({ ol, line }) => ClientOrderLineDto.parse({
    id: ol.id, lineRef: line.lineRef, name: line.name, qty: ol.qty, unit: ol.unit, unitPrice: { minorE2: ol.unitPriceMinorE2, currency: o.currency, unit: ol.unit },
    fee: o.pricingDisplay === "factory_plus_fee" ? { minor: ol.feeMinor, currency: o.currency } : null, specVersion: ol.specVersion, artworkRequired: ol.artworkRequired, clientSku: line.clientSku,
  }));
  const pays = payRows.map((p) => ClientPaymentDto.parse({
    id: p.id, kind: p.kind, pct: p.pct, amount: { minor: p.amountMinor, currency: p.currency }, status: p.status, dueOn: p.dueOn,
    dueLabel: p.status === "paid" ? null : p.dueOn ? `due ${formatDate(p.dueOn)}` : p.kind === "balance" ? "on QC pass" : null, paidAt: p.paidAt?.toISOString() ?? null,
  }));
  const latestDieline = (await clientDocumentsFor(db, orgId, [{ entityType: "order", entityId: o.id }])).find((d) => d.kind === "dieline") ?? null;
  const artworkDtos = [];
  const artworkDue: { orderLineId: string; lineRef: string; name: string }[] = [];
  for (const { ol, line } of olRows) {
    const cur = artRows.find((a) => a.orderLineId === ol.id) ?? null;
    if (cur) {
      artworkDtos.push(ClientArtworkDto.parse({
        id: cur.id, lineRef: line.lineRef, version: cur.version, status: cur.status, file: await clientDocumentByFileId(db, orgId, cur.fileId), dieline: (await clientDocumentByFileId(db, orgId, cur.dielineFileId)) ?? latestDieline,
        note: cur.clientNote, decidedAt: cur.decidedAt?.toISOString() ?? null,
      }));
      if (ol.artworkRequired && cur.status === "changes_requested") artworkDue.push({ orderLineId: ol.id, lineRef: line.lineRef, name: line.name });
    } else if (ol.artworkRequired) artworkDue.push({ orderLineId: ol.id, lineRef: line.lineRef, name: line.name });
  }
  const insp = inspRows[0] ?? null;
  const inspection = insp ? ClientInspectionDto.parse({ scheduledFor: insp.scheduledFor, inspectedAt: insp.inspectedAt?.toISOString() ?? null, result: insp.result, report: insp.visibleToClient ? await clientDocumentById(db, orgId, insp.reportDocumentId) : null }) : null;
  const ship = shipRows[0] ?? null;
  const shipment = ship ? ClientShipmentDto.parse({
    forwarderName: ship.forwarderParty === "client" ? ship.forwarder : null, mode: ship.mode, containerOrAwb: ship.containerOrAwb, cargoReady: ship.cargoReady, etd: ship.etd, etaPort: ship.etaPort, portOfDischarge: ship.portOfDischarge,
    arrivedPortAt: ship.arrivedPortAt?.toISOString() ?? null, customsStatus: ship.customsStatus, deliveredAt: ship.deliveredAt?.toISOString() ?? null,
    billOfLading: await clientDocumentById(db, orgId, ship.blDocumentId), packingList: await clientDocumentById(db, orgId, ship.packingListDocumentId),
  }) : null;
  const documents = await clientDocumentsFor(db, orgId, [
    { entityType: "order", entityId: o.id }, ...lineIds.map((id) => ({ entityType: "request_line" as const, entityId: id })), ...sampleRows.map((s) => ({ entityType: "sample" as const, entityId: s.id })),
  ]);
  const hasFactoryRange = lineIds.length ? !!(await factoryLabelForLine(db, { lineId: lineIds[0], orgId })) : false;
  const waitingReason = lc ? clientWaitingReason(lc) : null;

  const order = ClientOrderDto.parse({
    id: o.id, ref: o.ref, requestRef: row.requestRef, name: lines[0]?.name ?? o.ref, state: o.state, milestone: o.milestone, milestoneStep: milestoneStep(o.milestone),
    subLabel: subLabelFor(o.state, { agentName: lc?.agentName }), exception: o.exception, exceptionText: exceptionClientText(o.exception), waitingReason,
    pricingDisplay: o.pricingDisplay, incoterm: o.incoterm, port: o.port, piNumber: o.piNumber, total: { minor: o.totalMinor, currency: o.currency }, confirmedAt: o.confirmedAt?.toISOString() ?? null,
    exworksEta: lc?.order?.exworksEta ?? null, etaLabel: lc ? etaLabelFor(lc) : null, deliveredAt: o.deliveredAt?.toISOString() ?? null, completedAt: o.completedAt?.toISOString() ?? null,
    lines, payments: pays, artworks: artworkDtos, inspection, shipment, documents, hasFactoryRange,
    canConfirmDelivery: o.state === "delivered" && o.exception !== "cancelled", canReorder: (o.state === "delivered" || o.state === "completed") && o.exception !== "cancelled", sampleSkipped: sampleRows.length === 0, lastChangeAt: o.lastStateChangeAt.toISOString(),
  });

  // Updates + History: client-visible events + comments on the order and its lines (D-07: one page holds the whole life)
  const entityIds = [o.id, ...lineIds];
  const [evs, cms] = await Promise.all([
    db.select().from(activityEvents).where(and(eq(activityEvents.orgId, orgId), eq(activityEvents.visibility, "client"), inArray(activityEvents.entityId, entityIds))).orderBy(desc(activityEvents.createdAt)).limit(300),
    db.select().from(comments).where(and(eq(comments.orgId, orgId), eq(comments.visibility, "client"), ne(comments.source, "whatsapp_log"), ne(comments.kind, "note"), inArray(comments.entityId, entityIds), isNull(comments.deletedAt))).orderBy(desc(comments.createdAt)),
  ]);
  const docById = new Map(documents.map((d) => [d.id, d]));
  const history = evs.map((e) => ClientEventDto.parse({
    id: e.id, type: e.type, text: eventText(e.type, e.payload), actorName: e.actorName, at: e.createdAt.toISOString(),
    isMilestone: (MILESTONE_EVENT_TYPES as readonly string[]).includes(e.type), isActionMilestone: typeof e.payload.milestone === "string" && isActionMilestone(e.payload.milestone as Milestone) && e.payload.milestoneChanged === true,
  }));
  const updates = [
    ...cms.map((c) => ClientUpdateDto.parse({ id: c.id, kind: "comment", at: c.createdAt.toISOString(), text: c.body, authorName: c.authorName, byYou: !!c.authorId && orgUserIds.has(c.authorId), isActionMilestone: false, attachments: c.attachments.map((id) => docById.get(id)).filter((d): d is NonNullable<typeof d> => !!d) })),
    ...evs.filter((e) => isFeedEvent(e.type, e.payload)).map((e) => ClientUpdateDto.parse({ id: e.id, kind: "event", at: e.createdAt.toISOString(), text: eventText(e.type, e.payload), authorName: e.actorName, byYou: !!e.actorId && orgUserIds.has(e.actorId), isActionMilestone: typeof e.payload.milestone === "string" && isActionMilestone(e.payload.milestone as Milestone) && e.payload.milestoneChanged === true, attachments: typeof e.payload.documentId === "string" && docById.get(e.payload.documentId) ? [docById.get(e.payload.documentId)!] : [] })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  const previousOrders = await previousOrdersOf(db, orgId, o.id, olRows.map((r) => r.ol.productId).filter((x): x is string => !!x));
  return ClientOrderPageDto.parse({ order, companyLabel: row.orgName, agentName: lc?.agentName ?? null, updates, history, previousOrders, artworkDue });
}

/** D-19: other delivered/completed orders of the same product(s) in this org. */
async function previousOrdersOf(db: DbOrTx, orgId: string, excludeOrderId: string, productIds: string[]): Promise<ClientPreviousOrderDto[]> {
  if (!productIds.length) return [];
  const rows = await db.select({ ol: orderLines, o: orders }).from(orderLines).innerJoin(orders, eq(orders.id, orderLines.orderId))
    .where(and(eq(orders.orgId, orgId), ne(orders.id, excludeOrderId), inArray(orderLines.productId, productIds), or(eq(orders.state, "delivered"), eq(orders.state, "completed"))!, isNull(orders.deletedAt)))
    .orderBy(desc(orders.deliveredAt));
  return rows.map(({ ol, o }) => ClientPreviousOrderDto.parse({ orderRef: o.ref, qty: ol.qty, unit: ol.unit, unitPrice: { minorE2: ol.unitPriceMinorE2, currency: o.currency, unit: ol.unit }, fee: o.pricingDisplay === "factory_plus_fee" ? { minor: ol.feeMinor, currency: o.currency } : null, deliveredAt: o.deliveredAt?.toISOString() ?? null }));
}

/* ═══════════════════════════ actions ═══════════════════════════ */

async function ownOrder(db: DbOrTx, ctx: Ctx, ref: string) {
  const [o] = await db.select().from(orders).where(and(eq(orders.ref, ref), eq(orders.orgId, ctx.orgId), isNull(orders.deletedAt))).for("update");
  if (!o) throw new NotFound("order");
  return o;
}

async function notifyAgent(tx: DbOrTx, o: { id: string; ref: string; assignedAgentId: string | null }, template: "ops_client_action" | "ops_client_question", subject: string, payload: Record<string, unknown>, discriminator: string, at: Date) {
  const all = await opsUsers(tx);
  const mine = o.assignedAgentId ? all.filter((u) => u.id === o.assignedAgentId) : [];
  for (const u of mine.length ? mine : all) {
    await enqueue({ userId: u.id, toEmail: u.email, template, entityRef: o.ref, subject, payload: { ref: o.ref, url: `/ops/orders/${o.ref}`, ...payload }, idempotencyKey: `${template}:${o.id}:${discriminator}:${u.id}`, at }, tx);
  }
}

const companyName = async (db: DbOrTx, orgId: string) => (await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, orgId)).limit(1))[0]?.name ?? "Client";

/** SPEC 3.4 delivered → completed by the client. */
export async function confirmDelivery(ctx: Ctx, ref: string, issues?: string | null) {
  if (!isClient(ctx)) throw new Forbidden("clients only");
  const db = await getDb();
  return db.transaction(async (tx) => {
    const o = await ownOrder(tx, ctx, ref);
    if (o.state !== "delivered") throw new ClientOrderError("E_NOT_DELIVERED");
    const at = now();
    await logActivity(tx, { orgId: o.orgId, entityType: "order", entityId: o.id, type: "delivery_confirmed", actorId: ctx.userId, actorName: ctx.name, visibility: "client", at, payload: { ref: o.ref, text: issues?.trim() ? `Delivery confirmed — ${issues.trim()}` : "Delivery confirmed" } });
    if (issues?.trim()) {
      const id = uuidv7();
      await tx.insert(comments).values({ id, orgId: o.orgId, entityType: "order", entityId: o.id, authorId: ctx.userId, authorName: ctx.name, body: issues.trim(), kind: "update", visibility: "client", source: "app", createdBy: ctx.userId, createdAt: at, updatedAt: at });
    }
    await transitionOrder(o.id, "completed", ctx, { tx, at: new Date(at.getTime() + 1000), notifyClient: false });
    await recordSupplierPerformance(tx, o.id, at); // SPEC 3.4: supplier_performance rolls up on completion (AC-ORD-05)
    for (const u of await clientUsersOf(tx, o.orgId)) {
      await enqueue({ userId: u.id, toEmail: u.email, template: "client_milestone_changed", entityRef: o.ref, subject: `${o.ref}: Delivered — thank you`, payload: { ref: o.ref, name: o.ref, milestone: "delivered", completed: true, url: `/app/orders/${o.ref}` }, idempotencyKey: `client_milestone_changed:${o.id}:completed:${u.id}`, at }, tx);
    }
    await notifyAgent(tx, o, "ops_client_action", `${await companyName(tx, o.orgId)}: delivery confirmed on ${o.ref}`, { action: "delivery_confirmed", issues: issues?.trim() || null }, "delivery_confirmed", at);
    return { ref: o.ref };
  });
}

/** SPEC 3.4 awaiting_artwork: client uploads artwork (pdf/ai/png/jpg ≤ 25 MB) → artworks.status=submitted, ops_client_action. */
export async function uploadArtwork(ctx: Ctx, ref: string, p: { orderLineId: string; filename: string; mime: string; data: Buffer; note: string | null }) {
  if (!isClient(ctx)) throw new Forbidden("clients only");
  const db = await getDb();
  return db.transaction(async (tx) => {
    const o = await ownOrder(tx, ctx, ref);
    const [ol] = await tx.select().from(orderLines).where(and(eq(orderLines.id, p.orderLineId), eq(orderLines.orderId, o.id))).limit(1);
    if (!ol) throw new NotFound("order line");
    const at = now();
    const sources = await loadLeakSources(tx);
    const stored = await storeDocument(tx, { orgId: o.orgId, userId: ctx.userId, actorName: ctx.name, data: p.data, mime: p.mime, filename: p.filename, entity: "order", entityId: o.id, kind: "artwork", visibility: "client", at, sources });
    const [prev] = await tx.select().from(artworks).where(and(eq(artworks.orderLineId, ol.id), isNull(artworks.deletedAt))).orderBy(desc(artworks.version)).limit(1);
    const version = (prev?.version ?? 0) + 1;
    const id = uuidv7();
    await tx.insert(artworks).values({ id, orgId: o.orgId, orderLineId: ol.id, version, fileId: stored.file.id, dielineFileId: prev?.dielineFileId ?? null, status: "submitted", clientNote: p.note?.trim() || null, createdBy: ctx.userId, createdAt: at, updatedAt: at });
    await logActivity(tx, { orgId: o.orgId, entityType: "order", entityId: o.id, type: "artwork_submitted", actorId: ctx.userId, actorName: ctx.name, visibility: "client", at: new Date(at.getTime() + 500), payload: { ref: o.ref, version, documentId: stored.documentId, filename: p.filename, text: `Artwork uploaded — v${version}` } });
    await notifyAgent(tx, o, "ops_client_action", `${await companyName(tx, o.orgId)}: artwork uploaded on ${o.ref}`, { action: "artwork_uploaded", version, filename: p.filename }, `artwork:${id}`, at);
    return { ref: o.ref, artworkId: id, version };
  });
}

/** "Ask about this order": client question → comment + ops_client_question to the agent. */
export async function askAboutOrder(ctx: Ctx, ref: string, text: string) {
  if (!isClient(ctx)) throw new Forbidden("clients only");
  const db = await getDb();
  return db.transaction(async (tx) => {
    const o = await ownOrder(tx, ctx, ref);
    const at = now();
    const body = text.trim();
    const id = uuidv7();
    await tx.insert(comments).values({ id, orgId: o.orgId, entityType: "order", entityId: o.id, authorId: ctx.userId, authorName: ctx.name, body, kind: "question", visibility: "client", source: "app", createdBy: ctx.userId, createdAt: at, updatedAt: at });
    await logActivity(tx, { orgId: o.orgId, entityType: "order", entityId: o.id, type: "comment_posted", actorId: ctx.userId, actorName: ctx.name, visibility: "client", at, payload: { ref: o.ref, commentId: id, kind: "question", text: `Question: ${body}` } });
    await notifyAgent(tx, o, "ops_client_question", `Question from ${await companyName(tx, o.orgId)} on ${o.ref}`, { text: body }, id, at);
    return { ref: o.ref, commentId: id };
  });
}

/**
 * F-12 Reorder (minimal path — no supplier-schema access from client code): a new request with `is_repeat` lines,
 * product/spec/SKU copied, assigned to the previous order's agent and moved to in_review. `reorder_created` is
 * client-visible on the new line; `ops_new_request` fires from the draft → submitted transition.
 * The "valid quote → negotiating + draft offer" fast path needs the sourcing board module (ops side).
 */
export async function reorder(ctx: Ctx, ref: string, p: { lines: { orderLineId: string; qty: number }[] }) {
  if (!isClient(ctx)) throw new Forbidden("clients only");
  const db = await getDb();
  return db.transaction(async (tx) => {
    const o = await ownOrder(tx, ctx, ref);
    if (o.state !== "delivered" && o.state !== "completed") throw new ClientOrderError("E_NOT_REORDERABLE");
    const at = now();
    const ols = await tx.select({ ol: orderLines, line: requestLines }).from(orderLines).innerJoin(requestLines, eq(requestLines.id, orderLines.requestLineId)).where(eq(orderLines.orderId, o.id)).orderBy(asc(orderLines.lineNo));
    const chosen = p.lines.map((sel) => ({ sel, row: ols.find((r) => r.ol.id === sel.orderLineId) })).filter((x): x is { sel: { orderLineId: string; qty: number }; row: (typeof ols)[number] } => !!x.row && x.sel.qty > 0);
    if (!chosen.length) throw new ClientOrderError("E_NO_LINES");
    const reqRef = await nextRef(tx as never, "REQ", at.getUTCFullYear());
    const requestId = uuidv7();
    await tx.insert(requests).values({ id: requestId, ref: reqRef, orgId: o.orgId, source: "portal", status: "draft", note: `Reorder of ${o.ref}`, createdBy: ctx.userId, createdAt: at, updatedAt: at });
    const lineRefs: string[] = [];
    let n = 1;
    for (const { sel, row } of chosen) {
      const lineId = uuidv7();
      const lr = mkLineRef(reqRef, n);
      const [prod] = row.ol.productId ? await tx.select({ id: products.id }).from(products).where(eq(products.id, row.ol.productId)).limit(1) : [];
      await tx.insert(requestLines).values({
        id: lineId, requestId, orgId: o.orgId, lineNo: n++, lineRef: lr, productId: prod?.id ?? null, name: row.line.name, qtyFirst: sel.qty, unit: row.ol.unit, clientSku: row.line.clientSku, customisation: row.line.customisation, materials: row.line.materials,
        clientLinks: row.line.clientLinks, linksMeta: row.line.linksMeta, state: "draft", milestone: "received", specVersion: row.ol.specVersion, artworkRequired: row.ol.artworkRequired, sampleRequired: false, isRepeat: true,
        assignedAgentId: o.assignedAgentId ?? row.line.assignedAgentId, lastStateChangeAt: at, createdBy: ctx.userId, createdAt: at, updatedAt: at,
      });
      await logActivity(tx, { orgId: o.orgId, entityType: "request_line", entityId: lineId, type: "line_created", actorId: ctx.userId, actorName: ctx.name, visibility: "client", at, payload: { ref: lr, isRepeat: true } });
      await transition(lineId, "submitted", ctx, { tx, at: new Date(at.getTime() + 1000) });
      await logActivity(tx, { orgId: o.orgId, entityType: "request_line", entityId: lineId, type: "reorder_created", actorId: ctx.userId, actorName: ctx.name, visibility: "client", at: new Date(at.getTime() + 1500), payload: { ref: lr, fromOrderRef: o.ref, text: `Reorder of ${o.ref}` } });
      await logActivity(tx, { orgId: o.orgId, entityType: "order", entityId: o.id, type: "reorder_created", actorId: ctx.userId, actorName: ctx.name, visibility: "client", at: new Date(at.getTime() + 1500), payload: { ref: o.ref, newRef: lr, text: `Reorder created — ${lr}` } });
      const agent = o.assignedAgentId ?? row.line.assignedAgentId;
      if (agent) {
        const [u] = await tx.select({ name: users.name }).from(users).where(eq(users.id, agent)).limit(1);
        await logActivity(tx, { orgId: o.orgId, entityType: "request_line", entityId: lineId, type: "line_assigned", actorId: ctx.userId, actorName: "System", visibility: "internal", at: new Date(at.getTime() + 2000), payload: { ref: lr, agentId: agent, agentName: u?.name ?? null, reason: "repeat order" } });
        await transition(lineId, "in_review", null, { tx, at: new Date(at.getTime() + 2500), payload: { agentName: u?.name ?? null } });
      }
      lineRefs.push(lr);
    }
    await tx.update(requests).set({ status: "active", submittedAt: at, updatedAt: at }).where(eq(requests.id, requestId));
    return ClientReorderResultDto.parse({ requestRef: reqRef, lineRefs, href: `/app/requests/${reqRef}` });
  });
}

/** Cheap existence/ownership probe for the route (404 for other orgs' refs). */
export async function clientOrderExists(ctx: Ctx, ref: string): Promise<boolean> {
  const db = await getDb();
  const [o] = await db.select({ id: orders.id }).from(orders).where(and(eq(orders.ref, ref), eq(orders.orgId, ctx.orgId), isNull(orders.deletedAt))).limit(1);
  return !!o;
}

