import Link from "next/link";
import { Plus } from "lucide-react";
import { requireOpsPage } from "@/server/shared/authorize";
import { getQueue } from "@/server/ops/requests";
import { PageHeader } from "@/components/shared/page-header";
import { PageBand } from "@/components/shared/section-band";
import { Button } from "@/components/ui/button";
import { QueueTable } from "@/components/ops/requests/queue-table";
import { claimQueueLineAction, assignQueueLinesAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Queue" };

const SCOPES = ["queue", "unassigned", "waiting"] as const;

/** F-14 — request queue: submitted / in_review lines (+ "waiting on us" scope) with Claim / Assign, filters, bulk assign. */
export default async function QueuePage({ searchParams }: { searchParams: Promise<{ scope?: string; client?: string; state?: string; agent?: string }> }) {
  const ctx = await requireOpsPage("/ops/queue");
  const sp = await searchParams;
  const scope = (SCOPES as readonly string[]).includes(sp.scope ?? "") ? (sp.scope as (typeof SCOPES)[number]) : "queue";
  const data = await getQueue(ctx, { scope });
  return (
    <>
      <PageHeader band
        eyebrow="Work"
        title="Queue"
        titleSuffix={<span>{data.rows.length} {data.rows.length === 1 ? "line" : "lines"}</span>}
        actions={<Button asChild variant="outline"><Link href="/ops/requests/new"><Plus data-icon="inline-start" />New request on behalf</Link></Button>}
      />
      <PageBand tone="page" pad="md">
        <QueueTable rows={data.rows} agents={data.agents} clients={data.clients} me={{ id: ctx.userId, name: ctx.name }} scope={scope} initial={{ client: sp.client ?? "", state: sp.state ?? "", agent: sp.agent ?? "" }} claim={claimQueueLineAction} assign={assignQueueLinesAction} />
      </PageBand>
    </>
  );
}
