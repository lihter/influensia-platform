/**
 * Client requests (SPEC F-04 intake, F-05 list, F-06 request page). Reads the app schema only; sourcing facts come from
 * `loadLineContexts` as numbers. Everything returned passes through a `.strict()` client DTO.
 *
 * `insertRequest()` is the shared core used by the client action (source `portal`/`import`) and by the ops
 * "on behalf" action (source `agent_on_behalf`) — the caller decides org, actor, source and notifications.
 */
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { z } from "zod";
import { getDb, type Db, type Tx } from "@/db";
import { requests, requestLines, organizations, documents, files, comments, activityEvents, users } from "@/db/schema/app";
import type { RequestSource } from "@/db/enums";
import type { LinkMeta } from "@/db/types";
import { type Ctx, isClient, Forbidden, NotFound } from "@/server/shared/authorize";
import { loadLineContexts, type LineContext } from "@/server/shared/line-context";
import { logActivity } from "@/server/shared/activity";
import { enqueue } from "@/server/shared/outbox";
import { transition } from "@/server/shared/transition";
import { storeDocument } from "@/server/shared/files";
import { nextRef, lineRef } from "@/server/shared/ids";
import { now } from "@/server/shared/clock";
import { milestoneFor, milestoneStep, isActionMilestone, isBeforeOrder, MILESTONES } from "@/server/shared/state-machine";
import { subLabelFor, exceptionClientText, eventText, isFeedEvent, MILESTONE_EVENT_TYPES } from "@/server/shared/labels";
import { clientUsersOf, opsUsers } from "@/server/shared/users";
import { factoryLabelForLine } from "@/server/shared/sourcing-counts";
import { ClientRequestDto, ClientRequestLineDto, ClientDocumentDto, ClientUpdateDto, ClientEventDto } from "./dto";
import { ClientListRowDto, ClientRequestListDto, ClientRequestPageDto, ClientRequestCreatedDto, type ClientListTabDto } from "./dto/requests";
import { clientWaitingReason, etaLabelFor } from "./dashboard";
import { parseLink } from "@/components/app/requests/link-parse";

/* ───────────────────────── Input schema (shared by the client + ops actions) ───────────────────────── */

export const MAX_LINES = 50;
export const MAX_IMAGES_PER_LINE = 10;

export const NewLineSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(200),
  qty: z.coerce.number().int("Enter a quantity").min(1, "Enter a quantity"),
  unit: z.string().trim().min(1).max(10).default("pcs"),
  links: z.array(z.string().url().max(2048)).max(20).default([]),
  note: z.string().trim().max(2000).nullable().default(null),
  clientSku: z.string().trim().max(80).nullable().default(null),
  targetDelivery: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  reorderInterval: z.enum(["none", "monthly", "quarterly", "yearly"]).nullable().default(null),
  volume12m: z.coerce.number().int().nonnegative().nullable().default(null),
  /** number of files attached in the multipart body under `line-{i}-file-{j}` */
  fileCount: z.number().int().min(0).max(MAX_IMAGES_PER_LINE).default(0),
});
export type NewLineInput = z.infer<typeof NewLineSchema>;

export const NewRequestSchema = z.object({
  lines: z.array(NewLineSchema).min(1, "Add at least one line").max(MAX_LINES, "Split into two requests (max 50 lines)"),
  note: z.string().trim().max(4000).nullable().default(null),
  targetDelivery: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  destination: z.string().trim().max(80).nullable().default(null),
  incotermWanted: z.string().trim().max(10).nullable().default(null),
  draft: z.boolean().default(false),
  /** `import` when the lines came from a CSV/xlsx import */
  source: z.enum(["portal", "import"]).default("portal"),
});
export type NewRequestInput = z.infer<typeof NewRequestSchema>;

export type UploadedFile = { data: Buffer; mime: string; name: string };
export type LineFiles = UploadedFile[][];

const IMAGE_MIME = /^image\/(jpeg|png|webp)$/;
const OTHER_MIME = /^(application\/pdf|text\/csv|application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet|application\/vnd\.ms-excel|text\/plain)$/;
const MAX_FILE_BYTES = 15 * 1024 * 1024;

/**
 * Reads the multipart body the intake form posts: `payload` (JSON of NewRequestInput) + `line-{i}-file-{j}` files.
 * Files are validated here (type, size, count) so the repository only sees clean buffers.
 */
export async function parseNewRequestForm(fd: FormData): Promise<{ input: NewRequestInput; files: LineFiles }> {
  const raw = fd.get("payload");
  const json = typeof raw === "string" ? JSON.parse(raw) : {};
  const input = NewRequestSchema.parse(json);
  const files: LineFiles = [];
  for (let i = 0; i < input.lines.length; i++) {
    const arr: UploadedFile[] = [];
    for (let j = 0; j < input.lines[i].fileCount; j++) {
      const f = fd.get(`line-${i}-file-${j}`);
      if (!(f instanceof File)) continue;
      if (f.size > MAX_FILE_BYTES) throw new z.ZodError([{ code: "custom", path: ["lines", i, "files"], message: "File too large (max 15 MB)", input: f.name }]);
      if (!IMAGE_MIME.test(f.type) && !OTHER_MIME.test(f.type)) throw new z.ZodError([{ code: "custom", path: ["lines", i, "files"], message: "Only JPG, PNG, WebP images (or a PDF/CSV/xlsx attachment) are accepted", input: f.name }]);
      arr.push({ data: Buffer.from(await f.arrayBuffer()), mime: f.type, name: f.name.slice(0, 200) });
    }
    files.push(arr);
  }
  return { input, files };
}

/* ───────────────────────── Create ───────────────────────── */

export type InsertRequestParams = {
  orgId: string;
  actor: { id: string; name: string; email: string };
  source: RequestSource;
  input: NewRequestInput;
  files: LineFiles;
  /** enqueue `client_request_received` to these users (client creator, or every client user when the agent ticked "notify client") */
  notifyClientUserIds: string[];
  /** ops on-behalf: "received via WhatsApp on {date}" → internal whatsapp_log comment on the request */
  whatsappNote?: { text: string; receivedOn: string | null } | null;
};

/** Core insert: request + lines (+ reference images) + activity + outbox, in one transaction. Nothing here trusts the org from input. */
export async function insertRequest(db: Db, p: InsertRequestParams): Promise<ClientRequestCreatedDto> {
  const { input } = p;
  const at = now();
  const draft = input.draft;
  const [org] = await db.select({ id: organizations.id, name: organizations.name, country: organizations.country, incoterm: organizations.defaultIncoterm }).from(organizations).where(and(eq(organizations.id, p.orgId), eq(organizations.type, "client"))).limit(1);
  if (!org) throw new NotFound("client org");
  const ref = await nextRef(db, "REQ", at.getUTCFullYear());
  const requestId = uuidv7();

  await db.transaction(async (tx) => {
    await tx.insert(requests).values({
      id: requestId, ref, orgId: org.id, source: p.source, status: draft ? "draft" : "submitted", note: input.note, submittedAt: draft ? null : at,
      targetDelivery: input.targetDelivery, destination: input.destination ?? org.country ?? null, incotermWanted: input.incotermWanted ?? org.incoterm,
      createdBy: p.actor.id, createdAt: at, updatedAt: at,
    });
    let lineNo = 0;
    for (const [i, l] of input.lines.entries()) {
      lineNo++;
      const lineId = uuidv7();
      const lRef = lineRef(ref, lineNo);
      const links = l.links.map((u) => parseLink(u)).filter((x): x is NonNullable<typeof x> => !!x);
      const linksMeta: LinkMeta[] = links.map((x) => ({ url: x.url, domain: x.domain, not_durable: x.notDurable }));
      const state = draft ? "draft" : "submitted";
      await tx.insert(requestLines).values({
        id: lineId, requestId, orgId: org.id, lineNo, lineRef: lRef, name: l.name, qtyFirst: l.qty, unit: l.unit, customisation: l.note, clientSku: l.clientSku,
        reorderInterval: l.reorderInterval && l.reorderInterval !== "none" ? l.reorderInterval : null, volume12m: l.volume12m,
        clientLinks: links.map((x) => x.url), linksMeta, state, milestone: milestoneFor(state), isRepeat: false, lastStateChangeAt: at,
        createdBy: p.actor.id, createdAt: at, updatedAt: at,
      });
      await logActivity(tx, { orgId: org.id, entityType: "request_line", entityId: lineId, type: "line_created", actorId: p.actor.id, actorName: p.actor.name, visibility: "client", at, payload: { ref: lRef, name: l.name, qty: l.qty, unit: l.unit, links: links.length, draft } });
      for (const f of p.files[i] ?? []) {
        await storeDocument(tx, {
          orgId: org.id, userId: p.actor.id, actorName: p.actor.name, data: f.data, mime: f.mime, filename: f.name, entity: "request_line", entityId: lineId,
          kind: IMAGE_MIME.test(f.mime) ? "reference_image" : "other", visibility: "client", at,
        });
      }
    }
    if (p.whatsappNote?.text) {
      await tx.insert(comments).values({
        id: uuidv7(), orgId: org.id, entityType: "request", entityId: requestId, authorId: p.actor.id, authorName: p.actor.name, body: p.whatsappNote.text, kind: "note",
        visibility: "internal", source: "whatsapp_log", counterparty: org.name, occurredAt: p.whatsappNote.receivedOn ? new Date(`${p.whatsappNote.receivedOn}T00:00:00Z`) : at, createdBy: p.actor.id, createdAt: at, updatedAt: at,
      });
      await logActivity(tx, { orgId: org.id, entityType: "request", entityId: requestId, type: "whatsapp_logged", actorId: p.actor.id, actorName: p.actor.name, visibility: "internal", at, payload: { ref, receivedOn: p.whatsappNote.receivedOn } });
    }
    if (!draft) {
      await logActivity(tx, { orgId: org.id, entityType: "request", entityId: requestId, type: "request_submitted", actorId: p.actor.id, actorName: p.actor.name, visibility: "client", at, payload: { ref, text: "Received", lines: input.lines.length, source: p.source } });
      const clientUsers = p.notifyClientUserIds.length ? (await clientUsersOf(tx, org.id)).filter((u) => p.notifyClientUserIds.includes(u.id)) : [];
      for (const u of clientUsers) {
        await enqueue({ userId: u.id, toEmail: u.email, template: "client_request_received", subject: `We received your request ${ref}`, entityRef: ref, payload: { ref, url: `/app/requests/${ref}`, lines: input.lines.length }, idempotencyKey: `client_request_received:${requestId}:${u.id}`, at }, tx);
      }
      for (const u of await opsUsers(tx)) {
        await enqueue({ userId: u.id, toEmail: u.email, template: "ops_new_request", subject: `New request ${ref} from ${org.name} (${input.lines.length} lines)`, entityRef: ref, payload: { ref, url: `/ops/requests/${ref}`, org: org.name, lines: input.lines.length, source: p.source }, idempotencyKey: `ops_new_request:${requestId}:${u.id}`, at }, tx);
      }
    }
  });

  return ClientRequestCreatedDto.parse({ id: requestId, ref, lineCount: input.lines.length, draft, href: `/app/requests/${ref}` });
}

/** Client "Send request" / "Save draft" (F-04). Org and actor always come from the session. */
export async function createClientRequest(ctx: Ctx, input: NewRequestInput, filesByLine: LineFiles): Promise<ClientRequestCreatedDto> {
  if (!isClient(ctx)) throw new Forbidden("clients only");
  const db = await getDb();
  return insertRequest(db, { orgId: ctx.orgId, actor: { id: ctx.userId, name: ctx.name, email: ctx.email }, source: input.source, input, files: filesByLine, notifyClientUserIds: input.draft ? [] : [ctx.userId] });
}

/** Client "Send request" on a draft: every draft line → submitted via transition() (which also enqueues ops_new_request). */
export async function submitDraftRequest(ctx: Ctx, requestId: string): Promise<{ ref: string }> {
  if (!isClient(ctx)) throw new Forbidden("clients only");
  const db = await getDb();
  return db.transaction(async (tx: Tx) => {
    const [req] = await tx.select().from(requests).where(and(eq(requests.id, requestId), eq(requests.orgId, ctx.orgId), isNull(requests.deletedAt))).for("update");
    if (!req) throw new NotFound("request");
    const lines = await tx.select({ id: requestLines.id, state: requestLines.state, qty: requestLines.qtyFirst }).from(requestLines).where(and(eq(requestLines.requestId, requestId), isNull(requestLines.deletedAt)));
    const drafts = lines.filter((l) => l.state === "draft");
    if (!drafts.length) throw new Forbidden("nothing to send");
    if (drafts.some((l) => !l.qty || l.qty < 1)) throw new z.ZodError([{ code: "custom", path: ["lines"], message: "Enter a quantity on every line", input: null }]);
    const at = now();
    for (const l of drafts) await transition(l.id, "submitted", ctx, { tx, at });
    await logActivity(tx, { orgId: ctx.orgId, entityType: "request", entityId: requestId, type: "request_submitted", actorId: ctx.userId, actorName: ctx.name, visibility: "client", at, payload: { ref: req.ref, text: "Received", lines: drafts.length } });
    await enqueue({ userId: ctx.userId, toEmail: ctx.email, template: "client_request_received", subject: `We received your request ${req.ref}`, entityRef: req.ref, payload: { ref: req.ref, url: `/app/requests/${req.ref}`, lines: drafts.length }, idempotencyKey: `client_request_received:${requestId}:${ctx.userId}`, at }, tx);
    return { ref: req.ref };
  });
}

/** Client deletes a draft (soft delete, no notifications). */
export async function deleteDraftRequest(ctx: Ctx, requestId: string): Promise<{ ref: string }> {
  if (!isClient(ctx)) throw new Forbidden("clients only");
  const db = await getDb();
  return db.transaction(async (tx: Tx) => {
    const [req] = await tx.select().from(requests).where(and(eq(requests.id, requestId), eq(requests.orgId, ctx.orgId), isNull(requests.deletedAt))).for("update");
    if (!req) throw new NotFound("request");
    if (req.status !== "draft") throw new Forbidden("only drafts can be deleted");
    const at = now();
    await tx.update(requestLines).set({ deletedAt: at, updatedAt: at }).where(eq(requestLines.requestId, requestId));
    await tx.update(requests).set({ deletedAt: at, updatedAt: at }).where(eq(requests.id, requestId));
    await logActivity(tx, { orgId: ctx.orgId, entityType: "request", entityId: requestId, type: "line_updated", actorId: ctx.userId, actorName: ctx.name, visibility: "client", at, payload: { ref: req.ref, text: "Draft deleted" } });
    return { ref: req.ref };
  });
}

/* ───────────────────────── List (F-05) ───────────────────────── */

export function tabOf(lc: LineContext): ClientListTabDto {
  if (lc.state === "draft") return "drafts";
  if (lc.exception === "cancelled" || lc.milestone === "delivered") return "delivered";
  return "active";
}

export function listRow(lc: LineContext): ClientListRowDto {
  const orderRef = lc.order?.ref ?? null;
  return ClientListRowDto.parse({
    id: lc.id, ref: lc.ref, requestRef: lc.requestRef, orderRef,
    displayRef: orderRef ? `${orderRef} · line ${String(lc.lineNo).padStart(2, "0")}` : lc.ref,
    href: lc.state === "draft" ? `/app/requests/${lc.requestRef}` : orderRef ? `/app/orders/${orderRef}` : `/app/lines/${lc.ref}`,
    name: lc.name, qty: lc.qty, unit: lc.unit, state: lc.state, milestone: lc.milestone, milestoneStep: milestoneStep(lc.milestone),
    subLabel: subLabelFor(lc.state, { agentName: lc.agentName, reached: lc.sourcing.reached, priced: lc.sourcing.priced, isRepeat: lc.isRepeat }),
    exception: lc.exception, exceptionText: exceptionClientText(lc.exception), waitingReason: clientWaitingReason(lc), sourcingProgress: lc.sourcing,
    etaLabel: etaLabelFor(lc), isRepeat: lc.isRepeat, isDraft: lc.state === "draft", isClosed: lc.exception === "cancelled", updatedAt: lc.updatedAt.toISOString(),
  });
}

export async function listClientRequests(ctx: Ctx): Promise<ClientRequestListDto> {
  if (!isClient(ctx)) throw new Forbidden("clients only");
  const db = await getDb();
  const [org] = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, ctx.orgId)).limit(1);
  const lcs = await loadLineContexts(db, { orgId: ctx.orgId, includeDrafts: true, includeCancelled: true });
  const rows = lcs
    .sort((a, b) => MILESTONES.indexOf(a.milestone) - MILESTONES.indexOf(b.milestone) || b.updatedAt.getTime() - a.updatedAt.getTime())
    .map(listRow);
  const counts = { active: 0, waiting: 0, delivered: 0, drafts: 0 };
  for (const r of rows) {
    counts[r.isDraft ? "drafts" : r.isClosed || r.milestone === "delivered" ? "delivered" : "active"]++;
    if (r.waitingReason) counts.waiting++;
  }
  return ClientRequestListDto.parse({ companyLabel: org?.name ?? "", rows, counts });
}

/* ───────────────────────── Request page (F-06) ───────────────────────── */

async function lineDto(db: Db, lc: LineContext): Promise<ClientRequestLineDto> {
  const price = lc.offer?.acceptedUnitPriceMinorE2 != null ? { minorE2: lc.offer.acceptedUnitPriceMinorE2, currency: lc.offer.currency, unit: lc.unit } : lc.order?.orderLine ? { minorE2: lc.order.orderLine.unitPriceMinorE2, currency: "USD", unit: lc.order.orderLine.unit } : null;
  const fee = lc.offer?.acceptedFeeMinor != null ? { minor: lc.offer.acceptedFeeMinor, currency: lc.offer.currency } : lc.order?.orderLine ? { minor: lc.order.orderLine.feeMinor, currency: "USD" } : null;
  const etaDate = lc.order?.etaPort ?? lc.order?.exworksEta ?? null;
  return ClientRequestLineDto.parse({
    id: lc.id, ref: lc.ref, requestRef: lc.requestRef, lineNo: lc.lineNo, name: lc.name, qty: lc.qty, unit: lc.unit, clientSku: lc.clientSku, links: lc.links, note: lc.note,
    state: lc.state, milestone: lc.milestone, milestoneStep: milestoneStep(lc.milestone),
    subLabel: subLabelFor(lc.state, { agentName: lc.agentName, reached: lc.sourcing.reached, priced: lc.sourcing.priced, isRepeat: lc.isRepeat }),
    exception: lc.exception, exceptionText: exceptionClientText(lc.exception), sourcingProgress: lc.sourcing, agentName: lc.agentName, specVersion: lc.specVersion, specSummary: null,
    isRepeat: lc.isRepeat, fromCatalog: lc.fromCatalog, factoryLabel: lc.fromRangeId ? await factoryLabelForLine(db, { lineId: lc.id, orgId: lc.orgId }) : null,
    waitingReason: clientWaitingReason(lc), price, fee, etaDate, etaLabel: etaLabelFor(lc),
    offerRef: lc.offer && lc.offer.status !== "draft" ? lc.offer.ref : null, sampleRef: lc.sample?.ref ?? null, orderRef: lc.order?.ref ?? null,
    sampleSkipped: !!lc.order && !lc.sample, lastChangeAt: lc.lastStateChangeAt.toISOString(), updatedAt: lc.updatedAt.toISOString(),
    canEdit: lc.state === "draft" || lc.state === "submitted" || lc.state === "in_review",
    canCancel: isBeforeOrder(lc.state) && lc.state !== "draft" && lc.exception !== "cancelled",
  });
}

export async function getClientRequest(ctx: Ctx, ref: string): Promise<ClientRequestPageDto> {
  if (!isClient(ctx)) throw new Forbidden("clients only");
  const db = await getDb();
  const [req] = await db.select().from(requests).where(and(eq(requests.ref, ref), eq(requests.orgId, ctx.orgId), isNull(requests.deletedAt))).limit(1);
  if (!req) throw new NotFound("request");
  const [org] = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, ctx.orgId)).limit(1);
  const lineIds = (await db.select({ id: requestLines.id }).from(requestLines).where(and(eq(requestLines.requestId, req.id), isNull(requestLines.deletedAt))).orderBy(asc(requestLines.lineNo))).map((r) => r.id);
  const lcs = (await loadLineContexts(db, { orgId: ctx.orgId, lineIds, includeDrafts: true, includeCancelled: true })).sort((a, b) => a.lineNo - b.lineNo);
  const lines: ClientRequestLineDto[] = [];
  for (const lc of lcs) lines.push(await lineDto(db, lc));
  const entityIds = [req.id, ...lineIds];

  const [docRows, cRows, eRows, orgUsers] = await Promise.all([
    db.select({ d: documents, bytes: files.bytes }).from(documents).innerJoin(files, eq(files.id, documents.fileId))
      .where(and(eq(documents.orgId, ctx.orgId), inArray(documents.entityId, entityIds), eq(documents.visibility, "client"), isNull(documents.deletedAt))).orderBy(desc(documents.createdAt)),
    db.select().from(comments).where(and(eq(comments.orgId, ctx.orgId), inArray(comments.entityId, entityIds), eq(comments.visibility, "client"), isNull(comments.deletedAt))).orderBy(desc(comments.createdAt)).limit(100),
    db.select().from(activityEvents).where(and(eq(activityEvents.orgId, ctx.orgId), inArray(activityEvents.entityId, entityIds), eq(activityEvents.visibility, "client"))).orderBy(desc(activityEvents.createdAt)).limit(300),
    db.select({ id: users.id }).from(users).where(eq(users.orgId, ctx.orgId)),
  ]);
  const orgUserIds = new Set(orgUsers.map((u) => u.id));
  const docs = docRows.map(({ d, bytes }) => ClientDocumentDto.parse({ id: d.id, filename: d.filename, kind: d.kind, bytes, uploadedAt: d.createdAt.toISOString(), downloadUrl: `/api/app/documents/${d.id}/download` }));
  const updates = [
    ...cRows.filter((c) => c.kind !== "note").map((c) => ClientUpdateDto.parse({ id: c.id, kind: "comment", at: c.createdAt.toISOString(), text: c.body, authorName: c.authorName, byYou: !!c.authorId && orgUserIds.has(c.authorId), isActionMilestone: false, attachments: [] })),
    ...eRows.filter((e) => isFeedEvent(e.type, e.payload) || e.type === "request_submitted").map((e) => ClientUpdateDto.parse({ id: e.id, kind: "event", at: e.createdAt.toISOString(), text: eventText(e.type, e.payload), authorName: e.actorName, byYou: !!e.actorId && orgUserIds.has(e.actorId), isActionMilestone: typeof e.payload.milestone === "string" && isActionMilestone(e.payload.milestone as never) && e.payload.milestoneChanged === true, attachments: [] })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  const history = eRows.map((e) => ClientEventDto.parse({ id: e.id, type: e.type, text: eventText(e.type, e.payload), actorName: e.actorName, at: e.createdAt.toISOString(), isMilestone: (MILESTONE_EVENT_TYPES as readonly string[]).includes(e.type), isActionMilestone: typeof e.payload.milestone === "string" && isActionMilestone(e.payload.milestone as never) && e.payload.milestoneChanged === true }));

  return ClientRequestPageDto.parse({
    companyLabel: org?.name ?? "",
    request: ClientRequestDto.parse({ id: req.id, ref: req.ref, status: req.status, source: req.source, clientRef: req.clientRef, note: req.note, submittedAt: req.submittedAt?.toISOString() ?? null, createdAt: req.createdAt.toISOString(), lines }),
    editable: lines.length > 0 && lines.every((l) => l.canEdit),
    documents: docs,
    updates,
    history,
  });
}
