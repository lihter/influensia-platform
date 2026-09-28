import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { and, asc, eq, lte, sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { getDb, type DbOrTx } from "@/db";
import { notificationOutbox } from "@/db/schema/app";
import type { NotificationTemplate } from "@/db/enums";
import { now } from "./clock";
import { leakCheck, type LeakSources } from "./leak-check";

export type OutboxRow = typeof notificationOutbox.$inferSelect;

export type EnqueueInput = {
  userId: string;
  toEmail?: string | null;
  template: NotificationTemplate;
  subject?: string;
  entityRef?: string;
  /** Client templates take ONLY client-DTO shaped payloads (SPEC §6). */
  payload: Record<string, unknown>;
  /** `<template>:<entityId>:<discriminator>` — duplicates are ignored (ON CONFLICT DO NOTHING). */
  idempotencyKey: string;
  sendAfter?: Date;
  at?: Date;
};

/** Transactional outbox (T-07). Pass the `tx` of the business write so the row commits with it. */
export async function enqueue(p: EnqueueInput, tx?: DbOrTx): Promise<void> {
  const db = tx ?? (await getDb());
  await db
    .insert(notificationOutbox)
    .values({
      id: uuidv7(),
      userId: p.userId,
      toEmail: p.toEmail ?? null,
      template: p.template,
      subject: p.subject ?? null,
      entityRef: p.entityRef ?? null,
      payload: p.payload,
      idempotencyKey: p.idempotencyKey,
      sendAfter: p.sendAfter ?? p.at ?? now(),
      createdAt: p.at ?? now(),
    })
    .onConflictDoNothing({ target: notificationOutbox.idempotencyKey });
}

export interface Sender {
  send(row: OutboxRow): Promise<void>;
}

export const OUTBOX_LOG = () => process.env.OUTBOX_LOG ?? path.join(process.cwd(), ".data", "outbox.log");

/** Local mode (SPEC §0.2): console line + one JSON line per email in ./.data/outbox.log. Nothing is transmitted. */
export const localSender: Sender = {
  async send(row) {
    const line = JSON.stringify({
      ts: now().toISOString(),
      id: row.id,
      template: row.template,
      to: row.toEmail ?? row.userId,
      subject: row.subject,
      entity_ref: row.entityRef,
      url: (row.payload as { url?: string }).url ?? null,
      payload: row.payload,
    });
    console.log(`[outbox] template=${row.template} to=${row.toEmail ?? row.userId} subject=${row.subject ?? ""}`);
    const file = OUTBOX_LOG();
    await mkdir(path.dirname(file), { recursive: true });
    await appendFile(file, line + "\n");
  },
};

/** Wraps any sender with the last-gate leak check on subject + serialised payload (ARCHITECTURE §6.5). */
export function withLeakGate(inner: Sender, sources: LeakSources): Sender {
  return {
    async send(row) {
      if (!row.template.startsWith("client_")) return inner.send(row);
      const r = leakCheck({ text: `${row.subject ?? ""}\n${JSON.stringify(row.payload)}` }, sources);
      if (!r.ok) throw new Error(`leak check: ${r.hits.map((h) => `${h.kind}:${h.match}`).join(", ")}`);
      return inner.send(row);
    },
  };
}

const BACKOFF_MIN = [1, 5, 15, 60, 240];

/** Drains due rows once. Backoff 1,5,15,60,240 min; `failed` after 5 attempts. */
export async function drain(sender: Sender = localSender, limit = 50, db?: DbOrTx) {
  const d = db ?? (await getDb());
  const t = now();
  const due = await d
    .select()
    .from(notificationOutbox)
    .where(and(eq(notificationOutbox.status, "pending"), lte(notificationOutbox.sendAfter, t)))
    .orderBy(asc(notificationOutbox.sendAfter))
    .limit(limit);
  let sent = 0, failed = 0;
  for (const row of due) {
    try {
      await sender.send(row);
      await d.update(notificationOutbox).set({ status: "sent", sentAt: t, attempts: row.attempts + 1, lastError: null }).where(eq(notificationOutbox.id, row.id));
      sent++;
    } catch (e) {
      const attempts = row.attempts + 1;
      const wait = BACKOFF_MIN[Math.min(attempts - 1, BACKOFF_MIN.length - 1)];
      await d
        .update(notificationOutbox)
        .set({
          attempts,
          lastError: String(e).slice(0, 1000),
          status: attempts >= 5 ? "failed" : "pending",
          sendAfter: sql`${t.toISOString()}::timestamptz + (${wait} || ' minutes')::interval`,
        })
        .where(eq(notificationOutbox.id, row.id));
      failed++;
    }
  }
  return { due: due.length, sent, failed };
}

/** Resets a failed row so the next drain retries it (F-27 "Retry"). */
export async function retry(id: string, db?: DbOrTx) {
  const d = db ?? (await getDb());
  await d.update(notificationOutbox).set({ status: "pending", sendAfter: now(), lastError: null }).where(eq(notificationOutbox.id, id));
}

export const outbox = { enqueue, drain, retry, localSender, withLeakGate };
