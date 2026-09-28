import { uuidv7 } from "uuidv7";
import { and, desc, eq } from "drizzle-orm";
import { getDb, type DbOrTx } from "@/db";
import { activityEvents } from "@/db/schema/app";
import type { ActivityType, EntityType, Visibility } from "@/db/enums";
import { now } from "./clock";

export type ActivityInput = {
  orgId: string;
  entityType: EntityType;
  entityId: string;
  type: ActivityType;
  actorId?: string | null;
  actorName?: string | null;
  /** MUST be a client DTO-shaped object when visibility = "client" (SPEC F-28). */
  payload?: Record<string, unknown>;
  visibility?: Visibility;
  at?: Date;
};

/**
 * Every mutation writes ≥1 activity event in the same transaction (SPEC F-28). Pass the `tx` you are inside of.
 * Returns the event id.
 */
export async function logActivity(tx: DbOrTx, input: ActivityInput): Promise<string> {
  const id = uuidv7();
  await tx.insert(activityEvents).values({
    id,
    orgId: input.orgId,
    entityType: input.entityType,
    entityId: input.entityId,
    actorId: input.actorId ?? null,
    actorName: input.actorName ?? null,
    type: input.type,
    payload: input.payload ?? {},
    visibility: input.visibility ?? "internal",
    createdAt: input.at ?? now(),
  });
  return id;
}

/** Convenience for callers outside a transaction. */
export async function log(input: ActivityInput): Promise<string> {
  return logActivity(await getDb(), input);
}

export const activity = { log, logActivity };

/** Events for one entity (newest first). Client callers must filter `visibility = client` — use the client repository instead. */
export async function listActivity(db: DbOrTx, p: { entityType: EntityType; entityId: string; visibility?: Visibility; limit?: number }) {
  const where = p.visibility
    ? and(eq(activityEvents.entityType, p.entityType), eq(activityEvents.entityId, p.entityId), eq(activityEvents.visibility, p.visibility))
    : and(eq(activityEvents.entityType, p.entityType), eq(activityEvents.entityId, p.entityId));
  return db.select().from(activityEvents).where(where).orderBy(desc(activityEvents.createdAt)).limit(p.limit ?? 200);
}
