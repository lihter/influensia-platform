"use client";
import * as React from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Play, RotateCcw, Search, Send, Sunrise, Inbox } from "lucide-react";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { DateTime } from "@/components/shared/formatters";
import { fmtDayTime, fmtDateTime } from "@/lib/format-date";
import { label } from "@/lib/labels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { NativeSelect } from "@/components/ops/clients/fields";
import type { ActionResult } from "@/server/shared/http";
import type { OutboxListRow, OutboxCounts } from "@/server/ops/outbox";
import type { NotificationTemplate } from "@/db/enums";

const OS = {
  status: { pending: "Pending", sent: "Sent", failed: "Failed" } as Record<string, string>,
  allStatuses: "All statuses",
  allTemplates: "All templates",
  search: "Recipient, subject or ref…",
  runWorker: "Run worker now",
  digest: "Trigger daily digest",
  retry: "Retry",
  col: { created: "Created", recipient: "Recipient", channel: "Ch", template: "Template", subject: "Subject", status: "Status", attempts: "Att", sentAt: "Sent" },
  empty: "No notifications match these filters",
  payload: "Rendered payload",
  logLine: "Local log line",
  noLog: "Not in the log yet — the worker has not sent this row.",
  lastError: "Last error",
  errors: { E_FORBIDDEN: "Admin only", E_INTERNAL: "Something went wrong", E_NOT_FOUND: "Not found", E_VALIDATION: "Invalid input", E_UNAUTHORIZED: "Sign in again" } as Record<string, string>,
};
const err = (c: string) => OS.errors[c] ?? c;
const statusVariant = (s: string) => (s === "sent" ? "success" : s === "failed" ? "danger" : "warning");

export type OutboxActions = {
  run: () => Promise<ActionResult<{ due: number; sent: number; failed: number }>>;
  retry: (r: { id: string }) => Promise<ActionResult<undefined>>;
  digest: () => Promise<ActionResult<{ enqueued: number; recipients: number }>>;
};

/** F-27 header buttons: "Run worker now" + "Trigger daily digest" (admin). */
export function OutboxHeaderActions({ admin, actions }: { admin: boolean; actions: OutboxActions }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [which, setWhich] = React.useState<"run" | "digest" | null>(null);
  if (!admin) return null;
  return (
    <>
      <Button
        variant="outline" disabled={pending} data-testid="trigger-digest"
        onClick={() => { setWhich("digest"); start(async () => { const r = await actions.digest(); if (r.ok) toast.success(`Daily digest queued for ${r.data.recipients} recipients (${r.data.enqueued} new)`); else toast.error(err(r.error)); setWhich(null); router.refresh(); }); }}
      >
        {pending && which === "digest" ? <Loader2 className="animate-spin" /> : <Sunrise />}{OS.digest}
      </Button>
      <Button
        disabled={pending} data-testid="run-worker"
        onClick={() => { setWhich("run"); start(async () => { const r = await actions.run(); if (r.ok) toast.success(`Worker ran — ${r.data.sent} sent, ${r.data.failed} failed, ${r.data.due} due`); else toast.error(err(r.error)); setWhich(null); router.refresh(); }); }}
      >
        {pending && which === "run" ? <Loader2 className="animate-spin" /> : <Play />}{OS.runWorker}
      </Button>
    </>
  );
}

/** Toolbar (section-alt band) + table + detail sheet. Status/template filters live in the URL so the list is server-filtered. */
export function OutboxView({ rows, counts, templates, admin, actions }: { rows: OutboxListRow[]; counts: OutboxCounts; templates: NotificationTemplate[]; admin: boolean; actions: OutboxActions }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [q, setQ] = React.useState(sp.get("q") ?? "");
  const [selected, setSelected] = React.useState<OutboxListRow | null>(null);
  const [pending, start] = React.useTransition();
  const status = sp.get("status") ?? "";
  const template = sp.get("template") ?? "";

  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(sp.toString());
    if (v) next.set(k, v); else next.delete(k);
    router.push(`${pathname}${next.size ? `?${next}` : ""}`);
  };

  const retry = (id: string) => start(async () => { const r = await actions.retry({ id }); if (r.ok) toast.success("Queued for retry"); else toast.error(err(r.error)); router.refresh(); });

  const columns: DataTableColumn<OutboxListRow>[] = [
    { id: "created", accessorKey: "createdAt", header: OS.col.created, meta: { numeric: true, sticky: true }, cell: ({ row }) => <span data-outbox-row={row.original.id} className="text-xs" title={fmtDateTime(row.original.createdAt)}>{fmtDayTime(row.original.createdAt)}</span> },
    { id: "subject", accessorKey: "subject", header: OS.col.subject, cell: ({ row }) => <div className="max-w-[48ch] min-w-0"><div className="truncate font-medium text-foreground" title={row.original.subject ?? undefined}>{row.original.subject}</div><div className="truncate text-xs text-muted-foreground" title={row.original.template}>{label("notificationTemplate", row.original.template)} · {label("notificationChannel", row.original.channel)}</div></div> },
    { id: "recipient", accessorKey: "recipient", header: OS.col.recipient, cell: ({ row }) => <span className="block max-w-[26ch] truncate" title={row.original.recipient}>{row.original.recipient}</span> },
    { id: "status", accessorKey: "status", header: OS.col.status, cell: ({ row }) => <Badge variant={statusVariant(row.original.status)} data-status={row.original.status}>{OS.status[row.original.status]}</Badge> },
    { id: "attempts", accessorKey: "attempts", header: OS.col.attempts, meta: { numeric: true } },
    { id: "sentAt", accessorKey: "sentAt", header: OS.col.sentAt, meta: { numeric: true }, cell: ({ row }) => (row.original.sentAt ? <span className="text-xs" title={fmtDateTime(row.original.sentAt)}>{fmtDayTime(row.original.sentAt)}</span> : <span className="text-faint">—</span>) },
  ];
  if (admin) {
    columns.push({
      id: "retry", header: "", meta: { numeric: true, width: "5rem" }, enableSorting: false,
      cell: ({ row }) => row.original.status === "failed" ? (
        <Button size="sm" variant="outline" disabled={pending} onClick={(e) => { e.stopPropagation(); retry(row.original.id); }}><RotateCcw />{OS.retry}</Button>
      ) : null,
    });
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 rounded-t-xl border border-b-0 border-hairline-strong bg-section-alt px-4 py-3">
        <div className="relative w-72 max-w-full">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={OS.search} className="pl-9" aria-label="Search outbox" />
        </div>
        <NativeSelect aria-label="Status" value={status} onChange={(e) => setParam("status", e.target.value)} className="w-40" data-testid="filter-status">
          <option value="">{OS.allStatuses}</option>
          {(["pending", "sent", "failed"] as const).map((s) => <option key={s} value={s}>{OS.status[s]} · {counts[s]}</option>)}
        </NativeSelect>
        <NativeSelect aria-label="Template" value={template} onChange={(e) => setParam("template", e.target.value)} className="w-64" data-testid="filter-template">
          <option value="">{OS.allTemplates}</option>
          {templates.map((t) => <option key={t} value={t}>{t}</option>)}
        </NativeSelect>
        <span className="ml-auto font-mono text-xs text-muted-foreground">{rows.length} rows</span>
      </div>
      <DataTable
        columns={columns} data={rows} density="compact" className="rounded-t-none" maxHeight="calc(100vh - 18rem)" globalFilter={q}
        rowHref={() => undefined} isSelected={(r) => r.id === selected?.id} rowClassName={() => "cursor-pointer"} data-testid="outbox-table"
        emptyState={<EmptyState icon={Inbox} title={OS.empty} />}
      />
      <RowClickBridge rows={rows} onOpen={setSelected} />
      <Sheet open={!!selected} onOpenChange={(o) => { if (!o) setSelected(null); }}>
        <SheetContent side="right" className="gap-0 p-0 sm:max-w-[40rem]" data-testid="outbox-detail">
          {selected && (
            <>
              <SheetHeader className="border-b border-border px-6 py-5 text-left">
                <div className="mb-1 font-mono text-2xs uppercase tracking-[0.08em] text-muted-foreground">{selected.template}{selected.entityRef ? ` · ${selected.entityRef}` : ""}</div>
                <SheetTitle className="text-lg font-semibold">{selected.subject}</SheetTitle>
                <SheetDescription className="flex flex-wrap items-center gap-2 text-sm text-ink-2">
                  <Send className="size-3.5" /> {selected.recipient}
                  <Badge variant={statusVariant(selected.status)}>{OS.status[selected.status]}</Badge>
                  <span className="font-mono text-xs text-muted-foreground">{selected.attempts} attempt{selected.attempts === 1 ? "" : "s"}</span>
                </SheetDescription>
              </SheetHeader>
              <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
                <dl className="grid grid-cols-[8rem_1fr] gap-x-4 gap-y-1.5 text-sm">
                  <dt className="text-xs font-medium text-muted-foreground">Created</dt><dd><DateTime value={selected.createdAt} variant="datetime" /></dd>
                  <dt className="text-xs font-medium text-muted-foreground">Send after</dt><dd><DateTime value={selected.sendAfter} variant="datetime" /></dd>
                  <dt className="text-xs font-medium text-muted-foreground">Sent</dt><dd>{selected.sentAt ? <DateTime value={selected.sentAt} variant="datetime" /> : <span className="text-faint">—</span>}</dd>
                  <dt className="text-xs font-medium text-muted-foreground">Row id</dt><dd className="font-mono text-xs">{selected.id}</dd>
                </dl>
                {selected.lastError && (
                  <div className="rounded-lg border border-danger-border bg-danger-wash px-3 py-2 text-sm text-danger">
                    <div className="text-2xs font-semibold uppercase tracking-[0.08em]">{OS.lastError}</div>
                    <pre className="mt-1 font-mono text-xs whitespace-pre-wrap">{selected.lastError}</pre>
                  </div>
                )}
                <div>
                  <div className="mb-1.5 text-2xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">{OS.payload}</div>
                  <pre className="overflow-auto rounded-lg bg-section-alt p-3 font-mono text-xs leading-5 text-foreground" data-testid="outbox-payload">{JSON.stringify(selected.payload, null, 2)}</pre>
                </div>
                <div>
                  <div className="mb-1.5 text-2xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">{OS.logLine}</div>
                  {selected.logLine ? (
                    <pre className="overflow-auto rounded-lg bg-section-alt p-3 font-mono text-xs leading-5 whitespace-pre-wrap break-all text-ink-2" data-testid="outbox-log-line">{selected.logLine}</pre>
                  ) : (
                    <p className="text-sm text-muted-foreground">{OS.noLog}</p>
                  )}
                </div>
              </div>
              {admin && selected.status === "failed" && (
                <div className="flex justify-end border-t border-border bg-card p-4">
                  <Button variant="outline" disabled={pending} onClick={() => retry(selected.id)}><RotateCcw />{OS.retry}</Button>
                </div>
              )}
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

/**
 * DataTable rows navigate via rowHref; for a detail sheet we listen for clicks / Enter on the rendered rows instead.
 * Each row's first cell carries `data-outbox-row={id}` so the handler can map the <tr> back to its row.
 */
function RowClickBridge({ rows, onOpen }: { rows: OutboxListRow[]; onOpen: (r: OutboxListRow) => void }) {
  React.useEffect(() => {
    const table = document.querySelector<HTMLElement>("[data-testid=outbox-table]");
    if (!table) return;
    const byId = new Map(rows.map((r) => [r.id, r]));
    const rowOf = (target: EventTarget | null) => {
      const tr = (target as HTMLElement | null)?.closest?.("tr[data-testid=data-row]");
      const id = tr?.querySelector<HTMLElement>("[data-outbox-row]")?.dataset.outboxRow;
      return id ? byId.get(id) : undefined;
    };
    const click = (e: Event) => { if ((e.target as HTMLElement).closest("button")) return; const r = rowOf(e.target); if (r) onOpen(r); };
    const key = (e: KeyboardEvent) => { if (e.key !== "Enter") return; const r = rowOf(e.target); if (r) onOpen(r); };
    table.addEventListener("click", click);
    table.addEventListener("keydown", key);
    return () => { table.removeEventListener("click", click); table.removeEventListener("keydown", key); };
  }, [rows, onOpen]);
  return null;
}
