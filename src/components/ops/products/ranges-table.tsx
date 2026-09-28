"use client";
import type { RangeRow } from "@/server/ops/ranges";
import { DataTable, PrimaryCell, type DataTableColumn } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { FactoryLabel } from "@/components/shared/factory-label";
import { DateTime } from "@/components/shared/formatters";
import { Badge } from "@/components/ui/badge";

export function RangeStatus({ r }: { r: { publishedAt: string | null; leakOk: boolean | null } }) {
  if (r.publishedAt) return <Badge variant="success">Published</Badge>;
  if (r.leakOk === false) return <Badge variant="danger">Blocked by leak check</Badge>;
  return <Badge variant="neutral">Draft</Badge>;
}

export function RangesTable({ rows }: { rows: RangeRow[] }) {
  const columns: DataTableColumn<RangeRow>[] = [
    { id: "ref", accessorKey: "ref", header: "Ref", meta: { sticky: true, width: "6rem" }, cell: ({ row }) => <span className="font-mono text-xs">{row.original.ref}</span> },
    { id: "label", accessorKey: "label", header: "Shown as", cell: ({ row }) => (row.original.label ? <FactoryLabel label={row.original.label} disclosed={false} /> : <span className="text-faint">assigned on publish</span>) },
    { id: "supplier", accessorKey: "supplierName", header: "Supplier (ops)", cell: ({ row }) => <PrimaryCell title={row.original.supplierName} sub={row.original.supplierRef} /> },
    { id: "org", accessorKey: "orgName", header: "Client" },
    { id: "items", accessorKey: "itemCount", header: "Items", meta: { numeric: true } },
    { id: "pdf", accessorKey: "hasPdf", header: "PDF", cell: ({ row }) => (row.original.hasPdf ? <Badge variant="neutral">pdf</Badge> : <span className="text-faint">—</span>) },
    { id: "status", accessorFn: (r) => (r.publishedAt ? 2 : r.leakOk === false ? 0 : 1), header: "Status", cell: ({ row }) => <RangeStatus r={row.original} /> },
    { id: "published", accessorKey: "publishedAt", header: "Published", meta: { numeric: true }, cell: ({ row }) => (row.original.publishedAt ? <DateTime value={row.original.publishedAt} variant="short" /> : <span className="text-faint">—</span>) },
    { id: "updated", accessorKey: "updatedAt", header: "Updated", meta: { numeric: true }, cell: ({ row }) => <DateTime value={row.original.updatedAt} variant="short" /> },
  ];
  return <DataTable columns={columns} data={rows} rowHref={(r) => `/ops/factory-ranges/${r.ref}`} initialSorting={[{ id: "ref", desc: true }]} data-testid="ranges-table" emptyState={<EmptyState title="No factory ranges yet" body="Build one from a supplier page or with + Range." className="py-8" />} />;
}
