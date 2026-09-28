import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Plus } from "lucide-react";
import { requireOpsPage } from "@/server/shared/authorize";
import { listOpsRequests } from "@/server/ops/requests";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { RequestsTable } from "@/components/ops/requests/requests-table";

export const dynamic = "force-dynamic";
export const metadata = { title: "Requests" };

/** F-14 — all requests with line roll-ups (state chips with counts, agents, stale count); filters client / state / agent / stale. */
export default async function OpsRequestsPage({ searchParams }: { searchParams: Promise<{ client?: string; state?: string; agent?: string; stale?: string; status?: string }> }) {
  const ctx = await requireOpsPage("/ops/requests");
  const sp = await searchParams;
  const [data, t] = await Promise.all([listOpsRequests(ctx), getTranslations("ops.requests")]);
  return (
    <>
      <PageHeader
        eyebrow={t("eyebrow")}
        title={t("title")}
        titleSuffix={<span>{data.rows.length} requests</span>}
        actions={<Button asChild><Link href="/ops/requests/new"><Plus data-icon="inline-start" />New request on behalf</Link></Button>}
      />
      <RequestsTable rows={data.rows} agents={data.agents} clients={data.clients} me={{ id: ctx.userId }} initial={{ client: sp.client ?? "", state: sp.state ?? "", agent: sp.agent ?? "", stale: sp.stale === "1", status: sp.status ?? "" }} />
    </>
  );
}
