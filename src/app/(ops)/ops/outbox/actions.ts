"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize } from "@/server/shared/authorize";
import { runOutboxWorker, retryOutboxRow, triggerDailyDigest } from "@/server/ops/outbox";
import { toActionError, type ActionResult } from "@/server/shared/http";

/** F-27 "Run worker now" (admin): one drain pass with the local sender. */
export async function runWorkerAction(): Promise<ActionResult<{ due: number; sent: number; failed: number }>> {
  try {
    const ctx = await authorize({ roles: ["admin"] });
    const r = await runOutboxWorker(ctx);
    revalidatePath("/ops/outbox");
    return { ok: true, data: r };
  } catch (e) {
    return toActionError(e);
  }
}

const Id = z.object({ id: z.uuid() });

/** F-27 "Retry": failed → pending, send_after = now. */
export async function retryOutboxAction(raw: { id: string }): Promise<ActionResult<undefined>> {
  try {
    const ctx = await authorize({ roles: ["admin"] });
    const { id } = Id.parse(raw);
    await retryOutboxRow(ctx, id);
    revalidatePath("/ops/outbox");
    return { ok: true, data: undefined };
  } catch (e) {
    return toActionError(e);
  }
}

/** F-27 "Trigger daily digest" (N-21): one ops_daily_digest row per agent/admin. */
export async function triggerDigestAction(): Promise<ActionResult<{ enqueued: number; recipients: number }>> {
  try {
    const ctx = await authorize({ roles: ["admin"] });
    const r = await triggerDailyDigest(ctx);
    revalidatePath("/ops/outbox");
    return { ok: true, data: r };
  } catch (e) {
    return toActionError(e);
  }
}
