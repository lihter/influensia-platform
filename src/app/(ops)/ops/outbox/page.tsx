import { Info } from "lucide-react";
import { requireOpsPage, isAdmin } from "@/server/shared/authorize";
import { listOutbox } from "@/server/ops/outbox";
import { PageHeader } from "@/components/shared/page-header";
import { PageBand } from "@/components/shared/section-band";
import { KpiTile } from "@/components/shared/kpi-tile";
import { OutboxView, OutboxHeaderActions } from "@/components/ops/outbox/outbox-view";
import { runWorkerAction, retryOutboxAction, triggerDigestAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Outbox" };

/** F-27 — every email the platform would have sent; local mode writes ./.data/outbox.log. Admin runs the worker, retries, triggers the digest. */
export default async function OutboxPage({ searchParams }: { searchParams: Promise<{ status?: string; template?: string; q?: string }> }) {
  const ctx = await requireOpsPage("/ops/outbox");
  const sp = await searchParams;
  const { rows, counts, templates, logPath } = await listOutbox(ctx, sp);
  const admin = isAdmin(ctx);
  const actions = { run: runWorkerAction, retry: retryOutboxAction, digest: triggerDigestAction };
  return (
    <>
      <PageHeader band
        eyebrow="Notifications"
        title="Outbox"
        titleSuffix={`${counts.total} rows · ${counts.pending} pending · ${counts.sent} sent · ${counts.failed} failed`}
        actions={<OutboxHeaderActions admin={admin} actions={actions} />}
      />
      <PageBand tone="page" pad="md">
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-info-border bg-info-wash px-3 py-2 text-sm text-info" role="status" data-testid="local-mode-banner">
          <Info className="size-4 shrink-0" />
          <span>Local mode — emails are written to <span className="font-mono text-xs">{logPath.replace(process.cwd(), ".")}</span>, not sent.</span>
        </div>
        <div className="mb-6 grid grid-cols-3 gap-4" data-testid="outbox-counts">
          <KpiTile label="Pending" value={counts.pending} meta="waiting for the worker" tone="warning" href="/ops/outbox?status=pending" />
          <KpiTile label="Sent" value={counts.sent} meta="written to the local log" tone="neutral" href="/ops/outbox?status=sent" />
          <KpiTile label="Failed" value={counts.failed} meta="5 attempts exhausted — retry" tone="info" href="/ops/outbox?status=failed" />
        </div>
        <OutboxView rows={rows} counts={counts} templates={templates} admin={admin} actions={actions} />
      </PageBand>
    </>
  );
}
