import { and, asc, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { organizations, requestLines, requests } from "@/db/schema/app";
import { isOps, Forbidden, type Ctx } from "@/server/shared/authorize";

export type AcceptedPick = { requestRef: string; orgName: string; lines: { lineRef: string; name: string }[] };

/** Requests with at least one line in `offer_accepted` (no order yet) — the "Confirm order" picker (UX top list). Read-only. */
export async function listAcceptedForOrder(ctx: Ctx): Promise<AcceptedPick[]> {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const db = await getDb();
  const rows = await db
    .select({ requestRef: requests.ref, orgName: organizations.name, lineRef: requestLines.lineRef, name: requestLines.name })
    .from(requestLines)
    .innerJoin(requests, eq(requests.id, requestLines.requestId))
    .innerJoin(organizations, eq(organizations.id, requests.orgId))
    .where(and(eq(requestLines.state, "offer_accepted"), isNull(requestLines.deletedAt)))
    .orderBy(asc(requests.ref), asc(requestLines.lineNo));
  const out = new Map<string, AcceptedPick>();
  for (const r of rows) {
    const g = out.get(r.requestRef) ?? { requestRef: r.requestRef, orgName: r.orgName, lines: [] };
    g.lines.push({ lineRef: r.lineRef, name: r.name });
    out.set(r.requestRef, g);
  }
  return [...out.values()];
}
