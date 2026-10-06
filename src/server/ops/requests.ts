/**
 * Ops queue + requests list + request detail + "new request on behalf" (SPEC F-14, F-04 ops variant).
 * Ops may read everything; the only rule is `isOps(ctx)` and that state changes go through transition() (assignLine).
 */
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { requests, requestLines, organizations, documents, files, comments, activityEvents } from "@/db/schema/app";
import type { LineState, LineException, Milestone, RequestSource, RequestStatus, Visibility, DocumentKind } from "@/db/enums";
import type { LinkMeta } from "@/db/types";
import { type Ctx, isOps, Forbidden, NotFound } from "@/server/shared/authorize";
import { loadLineContexts, type LineContext } from "@/server/shared/line-context";
import { isUnassigned } from "./dashboard";
import { daysBetween } from "@/server/shared/dates";
import { opsUsers, clientUsersOf, userNames } from "@/server/shared/users";
import type { WaitingReason, WaitingParty } from "@/server/shared/derived";
import { insertRequest, type NewRequestInput, type LineFiles } from "@/server/client/requests";
import type { ClientRequestCreatedDto } from "@/server/client/dto/requests";
import { lineThumbs, mediaItems, OPS_MEDIA, type MediaItem, type Thumb } from "@/server/shared/media";
import { linkDomain } from "@/lib/media";

/* ───────────────────────── Queue (F-14) ───────────────────────── */

export type QueueRow = {
  lineId: string;
  ref: string;
  requestRef: string;
  href: string;
  name: string;
  image: Thumb | null;
  linkDomain: string | null;
  orgId: string;
  orgName: string;
  qty: number | null;
  unit: string;
  links: LinkMeta[];
  notDurable: number;
  imagesCount: number;
  source: RequestSource | "catalog" | "range" | "repeat";
  submittedAt: string;
  lastChangeAt: string;
  daysSinceChange: number;
  state: LineState;
  exception: LineException | null;
  agentId: string | null;
  agentName: string | null;
  waitingParty: WaitingParty;
  waitingReason: WaitingReason;
  stale: boolean;
  isNew: boolean;
};

export type Agent = { id: string; name: string; role: string };
export type ClientOrg = { id: string; name: string; country: string | null };

const QUEUE_STATES: readonly LineState[] = ["submitted", "in_review"];

async function imageCounts(db: Awaited<ReturnType<typeof getDb>>, lineIds: string[]): Promise<Record<string, number>> {
  if (!lineIds.length) return {};
  const rows = await db.select({ id: documents.entityId, n: sql<number>`count(*)` }).from(documents)
    .where(and(eq(documents.entityType, "request_line"), inArray(documents.entityId, lineIds), eq(documents.kind, "reference_image"), isNull(documents.deletedAt))).groupBy(documents.entityId);
  return Object.fromEntries(rows.map((r) => [r.id, Number(r.n)]));
}

async function linksMetaFor(db: Awaited<ReturnType<typeof getDb>>, lineIds: string[]): Promise<Record<string, LinkMeta[]>> {
  if (!lineIds.length) return {};
  const rows = await db.select({ id: requestLines.id, meta: requestLines.linksMeta, links: requestLines.clientLinks }).from(requestLines).where(inArray(requestLines.id, lineIds));
  return Object.fromEntries(rows.map((r) => [r.id, r.meta?.length ? r.meta : (r.links ?? []).map((url) => ({ url }))]));
}

function sourceOf(lc: LineContext, requestSource: RequestSource): QueueRow["source"] {
  if (lc.isRepeat) return "repeat";
  if (lc.fromRangeId) return "range";
  if (lc.fromCatalog) return "catalog";
  return requestSource;
}

function queueRow(lc: LineContext, extra: { links: LinkMeta[]; images: number; image: Thumb | null; source: RequestSource }, at: Date): QueueRow {
  return {
    lineId: lc.id, ref: lc.ref, requestRef: lc.requestRef, href: `/ops/lines/${lc.ref}?tab=spec`, name: lc.name, image: extra.image, linkDomain: linkDomain(lc.links), orgId: lc.orgId, orgName: lc.orgName, qty: lc.qty, unit: lc.unit,
    links: extra.links, notDurable: extra.links.filter((l) => l.not_durable).length, imagesCount: extra.images, source: sourceOf(lc, extra.source),
    submittedAt: lc.createdAt.toISOString(), lastChangeAt: lc.lastStateChangeAt.toISOString(), daysSinceChange: daysBetween(lc.lastStateChangeAt, at),
    state: lc.state, exception: lc.exception, agentId: lc.assignedAgentId, agentName: lc.agentName, waitingParty: lc.waiting.party, waitingReason: lc.waiting.reason, stale: lc.stale,
    isNew: at.getTime() - lc.createdAt.getTime() < 24 * 3600 * 1000,
  };
}

/**
 * Queue = lines in `submitted` / `in_review` (SPEC F-14) plus, with `scope: "waiting"`, every other line whose next move is ours
 * (waiting on agency) so the page doubles as the "what do we owe" list.
 */
export async function getQueue(ctx: Ctx, opts: { scope?: "queue" | "unassigned" | "waiting" } = {}): Promise<{ rows: QueueRow[]; agents: Agent[]; clients: ClientOrg[] }> {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const db = await getDb();
  const at = new Date();
  const lcs = (await loadLineContexts(db, {})).filter((lc) => lc.exception !== "on_hold");
  const scope = opts.scope ?? "queue";
  const picked = lcs.filter((lc) =>
    scope === "unassigned" ? isUnassigned({ agentId: lc.assignedAgentId, state: lc.state })
    : scope === "waiting" ? QUEUE_STATES.includes(lc.state) || lc.waiting.party === "agency"
    : QUEUE_STATES.includes(lc.state) || isUnassigned({ agentId: lc.assignedAgentId, state: lc.state }));
  const ids = picked.map((l) => l.id);
  const [images, links, thumbs, reqRows, agents, clients] = await Promise.all([
    imageCounts(db, ids), linksMetaFor(db, ids), lineThumbs(db, ids, OPS_MEDIA),
    ids.length ? db.select({ id: requests.id, source: requests.source }).from(requests).where(inArray(requests.id, [...new Set(picked.map((l) => l.requestId))])) : [],
    listAgents(ctx), listClientOrgs(ctx),
  ]);
  const srcByReq = new Map(reqRows.map((r) => [r.id, r.source]));
  const rows = picked.map((lc) => queueRow(lc, { links: links[lc.id] ?? [], images: images[lc.id] ?? 0, image: thumbs.get(lc.id) ?? null, source: srcByReq.get(lc.requestId) ?? "portal" }, at))
    .sort((a, b) => (a.agentId ? 1 : 0) - (b.agentId ? 1 : 0) || a.submittedAt.localeCompare(b.submittedAt));
  return { rows, agents, clients };
}

export async function listAgents(ctx: Ctx): Promise<Agent[]> {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const db = await getDb();
  return (await opsUsers(db)).map((u) => ({ id: u.id, name: u.name, role: u.role })).sort((a, b) => a.name.localeCompare(b.name));
}

export async function listClientOrgs(ctx: Ctx): Promise<ClientOrg[]> {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const db = await getDb();
  return db.select({ id: organizations.id, name: organizations.name, country: organizations.country }).from(organizations).where(and(eq(organizations.type, "client"), isNull(organizations.deletedAt))).orderBy(asc(organizations.name));
}

/* ───────────────────────── Requests list (F-14) ───────────────────────── */

export type OpsRequestRow = {
  id: string;
  ref: string;
  href: string;
  orgId: string;
  orgName: string;
  source: RequestSource;
  status: RequestStatus;
  lineCount: number;
  /** state → count, in lane order */
  states: { state: LineState; count: number }[];
  agentIds: string[];
  agentNames: string[];
  staleCount: number;
  waitingUsCount: number;
  unassignedCount: number;
  submittedAt: string | null;
  updatedAt: string;
  lastChangeAt: string;
  firstLineName: string;
  /** pictures of the first lines, in line order */
  media: MediaItem[];
};

export async function listOpsRequests(ctx: Ctx): Promise<{ rows: OpsRequestRow[]; agents: Agent[]; clients: ClientOrg[] }> {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const db = await getDb();
  const reqRows = await db.select({ r: requests, orgName: organizations.name }).from(requests).innerJoin(organizations, eq(organizations.id, requests.orgId)).where(isNull(requests.deletedAt)).orderBy(desc(requests.createdAt));
  const lcs = await loadLineContexts(db, { includeDrafts: true, includeCancelled: true });
  const byReq = new Map<string, LineContext[]>();
  for (const lc of lcs) byReq.set(lc.requestId, [...(byReq.get(lc.requestId) ?? []), lc]);
  const [agents, clients, thumbs] = await Promise.all([listAgents(ctx), listClientOrgs(ctx), lineThumbs(db, lcs.map((l) => l.id), OPS_MEDIA)]);
  const rows: OpsRequestRow[] = reqRows.map(({ r, orgName }) => {
    const lines = (byReq.get(r.id) ?? []).sort((a, b) => a.lineNo - b.lineNo);
    const counts = new Map<LineState, number>();
    for (const l of lines) counts.set(l.state, (counts.get(l.state) ?? 0) + 1);
    const agentIds = [...new Set(lines.map((l) => l.assignedAgentId).filter((x): x is string => !!x))];
    const agentNames = [...new Set(lines.map((l) => l.agentName).filter((x): x is string => !!x))];
    const last = lines.reduce<Date | null>((m, l) => (!m || l.lastStateChangeAt > m ? l.lastStateChangeAt : m), null) ?? r.updatedAt;
    return {
      id: r.id, ref: r.ref, href: `/ops/requests/${r.ref}`, orgId: r.orgId, orgName, source: r.source, status: r.status, lineCount: lines.length,
      states: [...counts.entries()].map(([state, count]) => ({ state, count })),
      agentIds, agentNames, staleCount: lines.filter((l) => l.stale).length, waitingUsCount: lines.filter((l) => l.waiting.party === "agency").length,
      unassignedCount: lines.filter((l) => isUnassigned({ agentId: l.assignedAgentId, state: l.state })).length,
      submittedAt: r.submittedAt?.toISOString() ?? null, updatedAt: r.updatedAt.toISOString(), lastChangeAt: last.toISOString(), firstLineName: lines[0]?.name ?? "",
      media: mediaItems(lines, thumbs),
    };
  });
  return { rows, agents, clients };
}

/* ───────────────────────── Request detail (F-14 / F-15 header) ───────────────────────── */

export type OpsRequestLine = QueueRow & { lineNo: number; milestone: Milestone; note: string | null; clientSku: string | null; specVersion: number | null; offerRef: string | null; sampleRef: string | null; orderRef: string | null; sourcing: { reached: number; priced: number } };

export type OpsRequestDetail = {
  id: string;
  ref: string;
  orgId: string;
  orgName: string;
  orgCountry: string | null;
  commercialMode: string;
  pricingDisplay: string;
  source: RequestSource;
  status: RequestStatus;
  note: string | null;
  clientRef: string | null;
  targetDelivery: string | null;
  destination: string | null;
  incotermWanted: string | null;
  submittedAt: string | null;
  createdAt: string;
  createdByName: string | null;
  lines: OpsRequestLine[];
  documents: { id: string; filename: string; kind: DocumentKind; visibility: Visibility; bytes: number; at: string; href: string; lineRef: string | null; isImage: boolean }[];
  notes: { id: string; body: string; kind: string; visibility: Visibility; source: string; authorName: string | null; at: string; counterparty: string | null; entityRef: string }[];
  activity: { id: string; type: string; visibility: Visibility; actorName: string | null; at: string; payload: Record<string, unknown>; entityRef: string }[];
  agents: Agent[];
  acceptedLineIds: string[];
};

export async function getOpsRequest(ctx: Ctx, ref: string): Promise<OpsRequestDetail> {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const db = await getDb();
  const [row] = await db.select({ r: requests, org: organizations }).from(requests).innerJoin(organizations, eq(organizations.id, requests.orgId)).where(and(eq(requests.ref, ref), isNull(requests.deletedAt))).limit(1);
  if (!row) throw new NotFound("request");
  const { r, org } = row;
  const at = new Date();
  const lineIds = (await db.select({ id: requestLines.id }).from(requestLines).where(and(eq(requestLines.requestId, r.id), isNull(requestLines.deletedAt)))).map((x) => x.id);
  const lcs = (await loadLineContexts(db, { lineIds, includeDrafts: true, includeCancelled: true })).sort((a, b) => a.lineNo - b.lineNo);
  const entityIds = [r.id, ...lineIds];
  const [images, links, thumbs, docRows, cRows, eRows, agents, creator] = await Promise.all([
    imageCounts(db, lineIds), linksMetaFor(db, lineIds), lineThumbs(db, lineIds, OPS_MEDIA),
    entityIds.length ? db.select({ d: documents, f: files }).from(documents).innerJoin(files, eq(files.id, documents.fileId)).where(and(inArray(documents.entityId, entityIds), isNull(documents.deletedAt))).orderBy(desc(documents.createdAt)) : [],
    db.select().from(comments).where(and(inArray(comments.entityId, entityIds), isNull(comments.deletedAt))).orderBy(desc(comments.createdAt)).limit(200),
    db.select().from(activityEvents).where(inArray(activityEvents.entityId, entityIds)).orderBy(desc(activityEvents.createdAt)).limit(400),
    listAgents(ctx),
    userNames(db, r.createdBy ? [r.createdBy] : []),
  ]);
  const refOf = (entityId: string) => (entityId === r.id ? r.ref : lcs.find((l) => l.id === entityId)?.ref ?? r.ref);
  const lines: OpsRequestLine[] = lcs.map((lc) => ({
    ...queueRow(lc, { links: links[lc.id] ?? [], images: images[lc.id] ?? 0, image: thumbs.get(lc.id) ?? null, source: r.source }, at),
    lineNo: lc.lineNo, milestone: lc.milestone, note: lc.note, clientSku: lc.clientSku, specVersion: lc.specVersion,
    offerRef: lc.offer?.ref ?? null, sampleRef: lc.sample?.ref ?? null, orderRef: lc.order?.ref ?? null, sourcing: lc.sourcing,
    href: lc.order ? `/ops/orders/${lc.order.ref}` : `/ops/lines/${lc.ref}?tab=${lc.state === "submitted" || lc.state === "in_review" || lc.state === "spec_frozen" ? "spec" : lc.state === "offer_ready" ? "offer" : "sourcing"}`,
  }));
  return {
    id: r.id, ref: r.ref, orgId: org.id, orgName: org.name, orgCountry: org.country, commercialMode: org.commercialMode, pricingDisplay: org.pricingDisplay,
    source: r.source, status: r.status, note: r.note, clientRef: r.clientRef, targetDelivery: r.targetDelivery, destination: r.destination, incotermWanted: r.incotermWanted,
    submittedAt: r.submittedAt?.toISOString() ?? null, createdAt: r.createdAt.toISOString(), createdByName: r.createdBy ? creator[r.createdBy] ?? null : null,
    lines,
    documents: docRows.map(({ d, f }) => ({ id: d.id, filename: d.filename, kind: d.kind, visibility: d.visibility, bytes: f.bytes, at: d.createdAt.toISOString(), href: `/api/files/${f.storageKey}`, lineRef: d.entityId === r.id ? null : refOf(d.entityId), isImage: f.mime.startsWith("image/") })),
    notes: cRows.map((c) => ({ id: c.id, body: c.body, kind: c.kind, visibility: c.visibility, source: c.source, authorName: c.authorName, at: c.createdAt.toISOString(), counterparty: c.counterparty, entityRef: refOf(c.entityId) })),
    activity: eRows.map((e) => ({ id: e.id, type: e.type, visibility: e.visibility, actorName: e.actorName, at: e.createdAt.toISOString(), payload: e.payload, entityRef: refOf(e.entityId) })),
    agents,
    acceptedLineIds: lcs.filter((l) => l.state === "offer_accepted").map((l) => l.id),
  };
}

/* ───────────────────────── New request on behalf (F-04 ops variant) ───────────────────────── */

export type OnBehalfInput = { orgId: string; input: NewRequestInput; files: LineFiles; notifyClient: boolean; whatsappNote: { text: string; receivedOn: string | null } | null };

export async function createRequestOnBehalf(ctx: Ctx, p: OnBehalfInput): Promise<ClientRequestCreatedDto> {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const db = await getDb();
  const notify = p.notifyClient && !p.input.draft ? (await clientUsersOf(db, p.orgId)).map((u) => u.id) : [];
  const created = await insertRequest(db, { orgId: p.orgId, actor: { id: ctx.userId, name: ctx.name, email: ctx.email }, source: "agent_on_behalf", input: p.input, files: p.files, notifyClientUserIds: notify, whatsappNote: p.whatsappNote });
  return { ...created, href: `/ops/requests/${created.ref}` };
}
