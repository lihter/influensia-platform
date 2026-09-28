"use client";
import * as React from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import type { OpsDashboard, OpsRow } from "@/server/ops/dashboard";
import type { ActionResult } from "@/server/shared/http";
import { DataTable, PrimaryCell, type DataTableColumn } from "@/components/shared/data-table";
import { StateChip, ExceptionChip } from "@/components/shared/chips";
import { EmptyState } from "@/components/shared/empty-state";
import { Age, DateTime, Qty } from "@/components/shared/formatters";
import { Button } from "@/components/ui/button";
import { nextStepLabel } from "@/lib/labels";
import { daysBetween } from "@/server/shared/dates";

function Section({ id, title, count, children }: { id: string; title: string; count: number; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} data-testid={`section-${id}`}>
      <h2 id={`${id}-h`} className="mb-3 flex items-baseline gap-2 text-lg font-semibold">{title} <span className="font-mono text-sm font-normal text-muted-foreground">{count}</span></h2>
      {children}
    </section>
  );
}

export function OpsDashboardTables({ dash, claim }: { dash: OpsDashboard; claim: (input: { lineId: string }) => Promise<ActionResult<{ lineRef: string }>> }) {
  const t = useTranslations("ops.dashboard");
  const [pending, start] = React.useTransition();
  const [claiming, setClaiming] = React.useState<string | null>(null);

  const base: DataTableColumn<OpsRow>[] = [
    { id: "name", accessorKey: "name", header: t("col.name"), meta: { sticky: true }, cell: ({ row }) => <PrimaryCell title={row.original.name} sub={<>{row.original.ref}{row.original.kind === "order" ? " · order" : ""}</>} /> },
    { id: "client", accessorKey: "orgName", header: t("col.client"), cell: ({ row }) => <span className="block max-w-[16ch] truncate" title={row.original.orgName}>{row.original.orgName}</span> },
    { id: "state", accessorKey: "state", header: t("col.state"), cell: ({ row }) => <span className="inline-flex items-center gap-1.5"><StateChip state={row.original.state} stale={row.original.stale} />{row.original.exception && <ExceptionChip exception={row.original.exception} />}</span> },
  ];
  const last: DataTableColumn<OpsRow> = { id: "last", accessorKey: "lastChangeAt", header: t("col.last"), meta: { numeric: true }, cell: ({ row }) => <Age since={row.original.lastChangeAt} stale={row.original.stale} /> };
  const agent: DataTableColumn<OpsRow> = { id: "agent", accessorKey: "agentName", header: t("col.agent"), cell: ({ row }) => row.original.agentName ?? <span className="text-faint">—</span> };
  const reason: DataTableColumn<OpsRow> = { id: "reason", accessorKey: "reason", header: "Next step", cell: ({ row }) => <span className="text-ink-2">{nextStepLabel(row.original.reason)}</span> };
  const since: DataTableColumn<OpsRow> = {
    id: "since", accessorKey: "lastChangeAt", header: t("col.since"), meta: { numeric: true },
    cell: ({ row }) => { const d = daysBetween(row.original.lastChangeAt); return <span className="inline-flex items-baseline gap-2"><DateTime value={row.original.lastChangeAt} variant="short" />{d > 5 && <span className="font-medium text-warning" title="Waiting more than 5 days">{d} d</span>}</span>; },
  };
  const qty: DataTableColumn<OpsRow> = { id: "qty", accessorKey: "qty", header: t("col.qty"), meta: { numeric: true }, cell: ({ row }) => (row.original.qty ? <Qty qty={row.original.qty} unit={row.original.unit} /> : "—") };
  const submitted: DataTableColumn<OpsRow> = { id: "submitted", accessorKey: "submittedAt", header: t("col.submitted"), meta: { numeric: true }, cell: ({ row }) => <DateTime value={row.original.submittedAt} variant="short" /> };
  const claimCol: DataTableColumn<OpsRow> = {
    id: "claim", header: "", meta: { numeric: true }, enableSorting: false,
    cell: ({ row }) => (
      <Button
        size="sm" variant="outline" data-testid="claim"
        disabled={pending && claiming === row.original.lineId}
        onClick={(e) => {
          e.stopPropagation();
          setClaiming(row.original.lineId);
          start(async () => {
            const r = await claim({ lineId: row.original.lineId });
            if (r.ok) toast.success(`Assigned to you · ${r.data.lineRef}`); else toast.error(r.error);
            setClaiming(null);
          });
        }}
      >
        {pending && claiming === row.original.lineId && <Loader2 className="animate-spin" />}
        {t("claim")}
      </Button>
    ),
  };
  const href = (r: OpsRow) => r.href;

  return (
    <div className="flex flex-col gap-8">
      <div className="grid gap-6 2xl:grid-cols-2">
        <Section id="stale" title={t("stale")} count={dash.stale.length}>
          <DataTable columns={[...base, last, agent]} data={dash.stale} rowHref={href} isStale={() => true} density="compact" emptyState={<EmptyState title={t("staleEmpty")} className="py-8" />} />
        </Section>
        <Section id="waiting-us" title={t("waitingUs")} count={dash.waitingUs.length}>
          <DataTable columns={[...base, reason, last, agent]} data={dash.waitingUs} rowHref={href} density="compact" emptyState={<EmptyState title={t("waitingUsEmpty")} className="py-8" />} />
        </Section>
      </div>
      <Section id="waiting-client" title={t("waitingClient")} count={dash.waitingClient.length}>
        <DataTable columns={[...base, reason, since, agent]} data={dash.waitingClient} rowHref={href} density="compact" emptyState={<EmptyState title={t("waitingClientEmpty")} className="py-8" />} />
      </Section>
      <Section id="unassigned" title={t("unassigned")} count={dash.unassigned.length}>
        <DataTable columns={[...base, qty, submitted, claimCol]} data={dash.unassigned} rowHref={href} isNew={() => true} density="compact" emptyState={<EmptyState title={t("unassignedEmpty")} className="py-8" />} />
      </Section>
    </div>
  );
}
