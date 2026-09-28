import { getTranslations } from "next-intl/server";
import { requireOpsPage } from "@/server/shared/authorize";
import { getOpsDashboard } from "@/server/ops/dashboard";
import { formatDate } from "@/server/shared/dates";
import { now } from "@/server/shared/clock";
import { PageHeader } from "@/components/shared/page-header";
import { KpiTile } from "@/components/shared/kpi-tile";
import { OpsDashboardTables } from "@/components/ops/ops-dashboard-tables";
import { claimLineAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dashboard" };

/** F-13 — KPI tiles + Stale / Waiting on us / Waiting on client / Unassigned. Default "Mine" for agents, "All" for admin. */
export default async function OpsDashboardPage({ searchParams }: { searchParams: Promise<{ scope?: string }> }) {
  const ctx = await requireOpsPage();
  const { scope } = await searchParams;
  const mine = scope ? scope === "mine" : ctx.role === "agent";
  const [dash, t] = await Promise.all([getOpsDashboard(ctx, { mine }), getTranslations("ops.dashboard")]);
  return (
    <>
      <PageHeader
        eyebrow={t("eyebrow", { date: formatDate(now(), "d MMM") })}
        title={t("title")}
        actions={
          <div className="inline-flex h-9 items-center rounded-lg bg-muted p-[3px] text-sm" role="tablist" aria-label="Scope">
            {[{ v: "mine", l: t("mine") }, { v: "all", l: t("all") }].map((o) => (
              <a key={o.v} href={`/ops?scope=${o.v}`} role="tab" aria-selected={(o.v === "mine") === mine} className={`flex h-full items-center rounded-md px-3 font-medium ${(o.v === "mine") === mine ? "bg-card text-foreground shadow-sm" : "text-ink-2"}`}>{o.l}</a>
            ))}
          </div>
        }
      />
      <div className="mb-6 grid grid-cols-2 gap-4 xl:grid-cols-4" data-testid="kpi-row">
        <KpiTile label={t("kpi.stale")} value={dash.counts.stale} meta={t("kpi.staleMeta")} tone="warning" href="#stale" />
        <KpiTile label={t("kpi.waitingUs")} value={dash.counts.waitingUs} meta={t("kpi.waitingUsMeta")} tone="info" href="#waiting-us" />
        <KpiTile label={t("kpi.waitingClient")} value={dash.counts.waitingClient} meta={t("kpi.waitingClientMeta")} tone="neutral" href="#waiting-client" />
        <KpiTile label={t("kpi.unassigned")} value={dash.counts.unassigned} meta={t("kpi.unassignedMeta")} tone="neutral" href="#unassigned" />
      </div>
      <OpsDashboardTables dash={dash} claim={claimLineAction} />
    </>
  );
}
