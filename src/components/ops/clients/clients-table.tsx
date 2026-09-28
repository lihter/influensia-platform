"use client";
import * as React from "react";
import { Search, Building2 } from "lucide-react";
import { DataTable, PrimaryCell, type DataTableColumn } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { Age } from "@/components/shared/formatters";
import { Input } from "@/components/ui/input";
import type { ClientOrgRow } from "@/server/ops/clients";
import { S, COMMERCIAL_MODE_LABEL, PRICING_DISPLAY_LABEL } from "./strings";

/** F-26 list — one row per client org, whole row → client page. */
export function ClientsTable({ rows }: { rows: ClientOrgRow[] }) {
  const [q, setQ] = React.useState("");
  const columns: DataTableColumn<ClientOrgRow>[] = [
    { id: "name", accessorKey: "name", header: S.col.name, meta: { sticky: true }, cell: ({ row }) => <PrimaryCell title={row.original.name} sub={row.original.vatId ?? undefined} /> },
    { id: "country", accessorKey: "country", header: S.col.country, cell: ({ row }) => <span className="font-mono text-[13px]">{row.original.country ?? "—"}</span> },
    { id: "users", accessorKey: "users", header: S.col.users, meta: { numeric: true } },
    { id: "mode", accessorKey: "commercialMode", header: S.col.mode, cell: ({ row }) => COMMERCIAL_MODE_LABEL[row.original.commercialMode] },
    { id: "display", accessorKey: "pricingDisplay", header: S.col.display, cell: ({ row }) => PRICING_DISPLAY_LABEL[row.original.pricingDisplay] },
    { id: "language", accessorKey: "language", header: S.col.language, cell: ({ row }) => <span className="font-mono text-[13px] uppercase">{row.original.language}</span> },
    { id: "currency", accessorKey: "currencyDisplay", header: S.col.currency, cell: ({ row }) => <span className="font-mono text-[13px]">{row.original.currencyDisplay}</span> },
    { id: "incoterm", accessorKey: "defaultIncoterm", header: S.col.incoterm, cell: ({ row }) => <span className="font-mono text-[13px]">{row.original.defaultIncoterm}</span> },
    { id: "openLines", accessorKey: "openLines", header: S.col.openLines, meta: { numeric: true, strong: true } },
    { id: "openOrders", accessorKey: "openOrders", header: S.col.openOrders, meta: { numeric: true, strong: true } },
    { id: "last", accessorKey: "lastActivityAt", header: S.col.last, meta: { numeric: true }, cell: ({ row }) => (row.original.lastActivityAt ? <Age since={row.original.lastActivityAt} /> : <span className="text-faint">—</span>) },
    { id: "partner", accessorKey: "partnerName", header: S.col.partner, cell: ({ row }) => row.original.partnerName ?? <span className="text-faint">—</span> },
  ];
  return (
    <div>
      <div className="flex items-center gap-3 rounded-t-xl border border-b-0 border-hairline-strong bg-section-alt px-4 py-3">
        <div className="relative w-72 max-w-full">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={S.search} className="pl-9" aria-label={S.search} />
        </div>
        <span className="ml-auto font-mono text-xs text-muted-foreground">{S.count(rows.length)}</span>
      </div>
      <DataTable
        columns={columns} data={rows} rowHref={(r) => `/ops/clients/${r.id}`} globalFilter={q} density="compact" className="rounded-t-none"
        initialSorting={[{ id: "name", desc: false }]} data-testid="clients-table"
        emptyState={<EmptyState icon={Building2} title={S.empty.title} body={S.empty.body} />}
      />
    </div>
  );
}
