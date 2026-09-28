/**
 * Notifications outbox viewer (SPEC F-27). Reads for every ops role; "Run worker now", "Retry" and "Trigger daily digest"
 * are admin-only. The worker is the foundation's `drain(localSender)` — local mode writes ./.data/outbox.log, nothing is sent.
 */
import { readFile } from "node:fs/promises";
import { and, desc, eq, sql } from "drizzle-orm";
import { getDb, type DbOrTx } from "@/db";
import { notificationOutbox } from "@/db/schema/app";
import { NOTIFICATION_TEMPLATES, OUTBOX_STATUSES, type NotificationTemplate, type OutboxStatus } from "@/db/enums";
import { type Ctx, isOps, isAdmin, Forbidden, NotFound } from "@/server/shared/authorize";
import { drain, localSender, retry, enqueue, OUTBOX_LOG } from "@/server/shared/outbox";
import { opsUsers } from "@/server/shared/users";
import { now } from "@/server/shared/clock";
import { getOpsDashboard, type OpsRow } from "./dashboard";

export type OutboxCounts = { pending: number; sent: number; failed: number; total: number };

export type OutboxListRow = {
  id: string;
  createdAt: string;
  sendAfter: string;
  sentAt: string | null;
  recipient: string;
  userId: string;
  channel: string;
  template: NotificationTemplate;
  subject: string | null;
  entityRef: string | null;
  status: OutboxStatus;
  attempts: number;
  lastError: string | null;
  payload: Record<string, unknown>;
  /** the JSON line the local sender appended to OUTBOX_LOG, when found */
  logLine: string | null;
};

export type OutboxFilter = { status?: string; template?: string; q?: string };

/** Pure: subject shown in the table — the stored subject, else a payload-derived one (SPEC F-27 "subject (rendered)"). */
export function renderSubject(row: { subject: string | null; template: string; payload: Record<string, unknown>; entityRef: string | null }): string {
  if (row.subject) return row.subject;
  const p = row.payload as { name?: string; ref?: string; milestone?: string };
  const ref = p.ref ?? row.entityRef ?? "";
  if (row.template === "client_milestone_changed" && p.name && p.milestone) return `${p.name}: ${p.milestone.replace(/_/g, " ")}`;
  return `${row.template.replace(/_/g, " ")}${ref ? ` — ${ref}` : ""}`;
}

/** Pure: index OUTBOX_LOG lines by outbox row id (the local sender writes `id`). Tolerates partial/garbled lines. */
export function indexLogLines(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split("\n")) {
    const l = line.trim();
    if (!l) continue;
    try {
      const j = JSON.parse(l) as { id?: string };
      if (j.id) out.set(j.id, l);
    } catch {
      /* skip non-JSON line */
    }
  }
  return out;
}

/** Pure: which status filter values are legal (anything else → no filter). */
export const parseStatusFilter = (s: string | undefined): OutboxStatus | undefined => (OUTBOX_STATUSES as readonly string[]).includes(s ?? "") ? (s as OutboxStatus) : undefined;
export const parseTemplateFilter = (s: string | undefined): NotificationTemplate | undefined => (NOTIFICATION_TEMPLATES as readonly string[]).includes(s ?? "") ? (s as NotificationTemplate) : undefined;

async function readLogIndex(): Promise<Map<string, string>> {
  try {
    return indexLogLines(await readFile(OUTBOX_LOG(), "utf8"));
  } catch {
    return new Map();
  }
}

export async function outboxCounts(ctx: Ctx): Promise<OutboxCounts> {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  return countsOf(await getDb());
}

async function countsOf(db: DbOrTx): Promise<OutboxCounts> {
  const rows = await db.select({ status: notificationOutbox.status, n: sql<number>`count(*)::int` }).from(notificationOutbox).groupBy(notificationOutbox.status);
  const c: OutboxCounts = { pending: 0, sent: 0, failed: 0, total: 0 };
  for (const r of rows) { c[r.status] = r.n; c.total += r.n; }
  return c;
}

/** Tiny badge helper for the shell / nav: number of rows waiting for the worker. No ctx — it exposes only a count. */
export async function pendingOutboxCount(db?: DbOrTx): Promise<number> {
  const d = db ?? (await getDb());
  const [r] = await d.select({ n: sql<number>`count(*)::int` }).from(notificationOutbox).where(eq(notificationOutbox.status, "pending"));
  return r?.n ?? 0;
}

export async function listOutbox(ctx: Ctx, filter: OutboxFilter = {}, limit = 500): Promise<{ rows: OutboxListRow[]; counts: OutboxCounts; templates: NotificationTemplate[]; logPath: string }> {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const db = await getDb();
  const status = parseStatusFilter(filter.status);
  const template = parseTemplateFilter(filter.template);
  const conds = [status ? eq(notificationOutbox.status, status) : undefined, template ? eq(notificationOutbox.template, template) : undefined].filter((x): x is NonNullable<typeof x> => !!x);
  const [rows, counts, log, tpl] = await Promise.all([
    db.select().from(notificationOutbox).where(conds.length ? and(...conds) : undefined).orderBy(desc(notificationOutbox.createdAt)).limit(limit),
    countsOf(db),
    readLogIndex(),
    db.selectDistinct({ template: notificationOutbox.template }).from(notificationOutbox).orderBy(notificationOutbox.template),
  ]);
  const q = filter.q?.trim().toLowerCase();
  const out = rows
    .map<OutboxListRow>((r) => ({
      id: r.id, createdAt: r.createdAt.toISOString(), sendAfter: r.sendAfter.toISOString(), sentAt: r.sentAt?.toISOString() ?? null,
      recipient: r.toEmail ?? r.userId, userId: r.userId, channel: r.channel, template: r.template, subject: renderSubject(r), entityRef: r.entityRef,
      status: r.status, attempts: r.attempts, lastError: r.lastError, payload: r.payload, logLine: log.get(r.id) ?? null,
    }))
    .filter((r) => !q || r.recipient.toLowerCase().includes(q) || (r.subject ?? "").toLowerCase().includes(q) || (r.entityRef ?? "").toLowerCase().includes(q));
  return { rows: out, counts, templates: tpl.map((t) => t.template), logPath: OUTBOX_LOG() };
}

export async function getOutboxRow(ctx: Ctx, id: string): Promise<OutboxListRow> {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const db = await getDb();
  const [r] = await db.select().from(notificationOutbox).where(eq(notificationOutbox.id, id)).limit(1);
  if (!r) throw new NotFound("outbox row not found");
  const log = await readLogIndex();
  return {
    id: r.id, createdAt: r.createdAt.toISOString(), sendAfter: r.sendAfter.toISOString(), sentAt: r.sentAt?.toISOString() ?? null,
    recipient: r.toEmail ?? r.userId, userId: r.userId, channel: r.channel, template: r.template, subject: renderSubject(r), entityRef: r.entityRef,
    status: r.status, attempts: r.attempts, lastError: r.lastError, payload: r.payload, logLine: log.get(r.id) ?? null,
  };
}

/** "Run worker now" (admin): one drain pass with the local sender. */
export async function runOutboxWorker(ctx: Ctx): Promise<{ due: number; sent: number; failed: number }> {
  if (!isAdmin(ctx)) throw new Forbidden("admin only");
  return drain(localSender);
}

/** "Retry" (admin): failed → pending, send_after = now. */
export async function retryOutboxRow(ctx: Ctx, id: string): Promise<void> {
  if (!isAdmin(ctx)) throw new Forbidden("admin only");
  const db = await getDb();
  const [r] = await db.select({ id: notificationOutbox.id, status: notificationOutbox.status }).from(notificationOutbox).where(eq(notificationOutbox.id, id)).limit(1);
  if (!r) throw new NotFound("outbox row not found");
  await retry(id, db);
}

const digestItem = (r: OpsRow) => ({ ref: r.ref, name: r.name, client: r.orgName, state: r.state, agent: r.agentName, since: r.lastChangeAt, url: r.href });

/**
 * "Trigger daily digest" (admin, SPEC N-21 / AC-OUT-03): one `ops_daily_digest` row per active agent/admin. Agents get "Mine"
 * (their lines + the unassigned queue), admins get "All". Idempotent per user per day.
 */
export async function triggerDailyDigest(ctx: Ctx): Promise<{ enqueued: number; recipients: number }> {
  if (!isAdmin(ctx)) throw new Forbidden("admin only");
  const db = await getDb();
  const at = now();
  const day = at.toISOString().slice(0, 10);
  const all = await getOpsDashboard(ctx, { mine: false });
  const recipients = await opsUsers(db);
  const before = await pendingOutboxCount(db);
  for (const u of recipients) {
    const mine = u.role === "agent";
    const pick = (rows: OpsRow[]) => rows.filter((r) => !mine || r.agentId === u.id || (!r.agentId && r.state === "submitted"));
    const stale = pick(all.stale), waitingUs = pick(all.waitingUs), unassigned = all.unassigned;
    await enqueue({
      userId: u.id, toEmail: u.email, template: "ops_daily_digest",
      subject: `Daily digest — ${stale.length} stale, ${waitingUs.length} waiting on us, ${unassigned.length} unassigned`,
      payload: { scope: mine ? "mine" : "all", date: day, url: "/ops", stale: stale.map(digestItem), waitingUs: waitingUs.map(digestItem), unassigned: unassigned.map(digestItem), counts: { stale: stale.length, waitingUs: waitingUs.length, unassigned: unassigned.length } },
      idempotencyKey: `ops_daily_digest:${day}:${u.id}`, at,
    });
  }
  const after = await pendingOutboxCount(db);
  return { enqueued: after - before, recipients: recipients.length };
}
