"use client";
import { DataTable, PrimaryCell, type DataTableColumn } from "@/components/shared/data-table";
import { StateChip, ExceptionChip } from "@/components/shared/chips";
import { EmptyState } from "@/components/shared/empty-state";
import { Age, DateTime, Money, Qty } from "@/components/shared/formatters";
import type { ClientLineRow, ClientOrderRow } from "@/server/ops/clients";
import { S } from "./strings";

/** F-26 Requests list for this client — rows link to /ops/lines/[ref] (line-page feature). */
export function ClientLinesTable({ rows }: { rows: ClientLineRow[] }) {
  const columns: DataTableColumn<ClientLineRow>[] = [
    { id: "name", accessorKey: "name", header: S.detail.colLine.name, meta: { sticky: true }, cell: ({ row }) => <PrimaryCell title={row.original.name} sub={row.original.ref} /> },
    { id: "qty", accessorKey: "qty", header: S.detail.colLine.qty, meta: { numeric: true }, cell: ({ row }) => (row.original.qty ? <Qty qty={row.original.qty} unit={row.original.unit} /> : "—") },
    { id: "state", accessorKey: "state", header: S.detail.colLine.state, cell: ({ row }) => <span className="inline-flex items-center gap-1.5"><StateChip state={row.original.state} stale={row.original.stale} />{row.original.exception && <ExceptionChip exception={row.original.exception} />}</span> },
    { id: "agent", accessorKey: "agentName", header: S.detail.colLine.agent, cell: ({ row }) => row.original.agentName ? <span className="whitespace-nowrap">{row.original.agentName}</span> : <span className="text-faint">—</span> },
    { id: "last", accessorKey: "lastChangeAt", header: S.detail.colLine.last, meta: { numeric: true }, cell: ({ row }) => <Age since={row.original.lastChangeAt} stale={row.original.stale} /> },
  ];
  return <DataTable columns={columns} data={rows} rowHref={(r) => r.href} isStale={(r) => r.stale} density="compact" data-testid="client-lines" emptyState={<EmptyState title={S.detail.linesEmpty} className="py-8" />} initialSorting={[{ id: "last", desc: true }]} />;
}

/** F-26 Orders list for this client — rows link to /ops/orders/[ref] (orders feature). */
export function ClientOrdersTable({ rows }: { rows: ClientOrderRow[] }) {
  const columns: DataTableColumn<ClientOrderRow>[] = [
    { id: "ref", accessorKey: "ref", header: S.detail.colOrder.ref, meta: { sticky: true }, cell: ({ row }) => <span className="font-mono text-xs">{row.original.ref}</span> },
    { id: "state", accessorKey: "state", header: S.detail.colOrder.state, cell: ({ row }) => <span className="inline-flex items-center gap-1.5"><StateChip state={row.original.state} stale={row.original.stale} />{row.original.exception && <ExceptionChip exception={row.original.exception} />}</span> },
    { id: "total", accessorKey: "totalMinor", header: S.detail.colOrder.total, meta: { numeric: true, strong: true }, cell: ({ row }) => <Money minor={row.original.totalMinor} currency={row.original.currency} strong /> },
    { id: "confirmed", accessorKey: "confirmedAt", header: S.detail.colOrder.confirmed, meta: { numeric: true }, cell: ({ row }) => <DateTime value={row.original.confirmedAt} variant="short" /> },
    { id: "last", accessorKey: "lastChangeAt", header: S.detail.colOrder.last, meta: { numeric: true }, cell: ({ row }) => <Age since={row.original.lastChangeAt} stale={row.original.stale} /> },
  ];
  return <DataTable columns={columns} data={rows} rowHref={(r) => r.href} isStale={(r) => r.stale} density="compact" data-testid="client-orders" emptyState={<EmptyState title={S.detail.ordersEmpty} className="py-8" />} />;
}
