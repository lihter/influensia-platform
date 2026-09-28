"use client";
import * as React from "react";
import { Search } from "lucide-react";
import type { OpsOrderRow } from "@/server/ops/orders";
import { DataTable, PrimaryCell, type DataTableColumn } from "@/components/shared/data-table";
import { StateChip, ExceptionChip, MilestoneChip } from "@/components/shared/chips";
import { EmptyState } from "@/components/shared/empty-state";
import { Age, DateTime, Money } from "@/components/shared/formatters";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { FilterToggle } from "@/components/shared/filter-toggle";

/** F-22 /ops/orders — DataTable with search, client + stale filters (DESIGN §5.4 toolbar on a section-alt band). */
export function OrdersTable({ rows }: { rows: OpsOrderRow[] }) {
  const [q, setQ] = React.useState("");
  const [staleOnly, setStaleOnly] = React.useState(false);
  const [client, setClient] = React.useState<string | null>(null);
  const [state, setState] = React.useState<"active" | "delivered" | "all">("all");
  const clients = [...new Set(rows.map((r) => r.orgName))].sort();
  const data = rows.filter((r) => (!staleOnly || r.stale) && (!client || r.orgName === client) && (state === "all" || (state === "delivered" ? r.milestone === "delivered" : r.milestone !== "delivered")));

  const columns: DataTableColumn<OpsOrderRow>[] = [
    { id: "ref", accessorKey: "ref", header: "Order", meta: { sticky: true }, cell: ({ row }) => <PrimaryCell title={row.original.name} sub={<>{row.original.ref}{row.original.linesCount > 1 ? ` · ${row.original.linesCount} lines` : ""}</>} /> },
    { id: "client", accessorKey: "orgName", header: "Client", cell: ({ row }) => <span className="block max-w-[16ch] truncate" title={row.original.orgName}>{row.original.orgName}</span> },
    { id: "state", accessorKey: "state", header: "State", cell: ({ row }) => <span className="inline-flex items-center gap-1.5"><StateChip state={row.original.state} stale={row.original.stale} />{row.original.exception && <ExceptionChip exception={row.original.exception} />}</span> },
    { id: "milestone", accessorKey: "milestone", header: "Milestone", cell: ({ row }) => <MilestoneChip milestone={row.original.milestone} waitingOnClient={row.original.waitingParty === "client"} /> },
    { id: "due", accessorKey: "dueMinor", header: "Due", meta: { numeric: true, strong: true }, cell: ({ row }) => (row.original.dueMinor ? <Money minor={row.original.dueMinor} currency={row.original.currency} strong /> : <span className="text-faint">—</span>) },
    { id: "paid", accessorKey: "paidMinor", header: "Paid", meta: { numeric: true }, cell: ({ row }) => <Money minor={row.original.paidMinor} currency={row.original.currency} /> },
    { id: "eta", accessorKey: "eta", header: "ETA", meta: { numeric: true }, cell: ({ row }) => (row.original.eta ? <span title={row.original.etaKind ?? undefined}><DateTime value={row.original.eta} variant="short" />{row.original.etaKind === "exworks" && <span className="ml-1 text-2xs text-muted-foreground">ex-works</span>}{row.original.etaKind === "delivered" && <span className="ml-1 text-2xs text-muted-foreground">delivered</span>}</span> : <span className="text-faint">—</span>) },
    { id: "agent", accessorKey: "agentName", header: "Agent", cell: ({ row }) => row.original.agentName ?? <span className="text-faint">—</span> },
    { id: "last", accessorKey: "lastChangeAt", header: "Last", meta: { numeric: true }, cell: ({ row }) => <Age since={row.original.lastChangeAt} stale={row.original.stale} /> },
  ];
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 rounded-t-xl border border-b-0 border-hairline-strong bg-section-alt px-4 py-3" data-testid="orders-toolbar">
        <div className="relative w-64 max-w-full">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search ref, product, client" className="h-8 pl-8 text-sm" aria-label="Search orders" />
        </div>
        <div className="inline-flex h-8 items-center rounded-lg border border-hairline-strong bg-background p-[3px] text-xs" role="tablist" aria-label="State">
          {(["all", "active", "delivered"] as const).map((s) => (
            <button key={s} type="button" role="tab" aria-selected={state === s} onClick={() => setState(s)} className={cn("h-full rounded-md px-2.5 font-medium capitalize", state === s ? "bg-card text-foreground shadow-sm" : "text-ink-2")}>{s}</button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {clients.map((c) => (
            <button key={c} type="button" aria-pressed={client === c} onClick={() => setClient(client === c ? null : c)} className={cn("h-7 rounded-full border px-2.5 text-xs font-medium transition-colors", client === c ? "border-foreground bg-foreground text-white" : "border-border bg-card text-ink-2 hover:bg-surface-sunken")}>{c}</button>
          ))}
        </div>
        <FilterToggle on={staleOnly} onChange={setStaleOnly} className="ml-auto">Stale only</FilterToggle>
        <span className="font-mono text-xs text-muted-foreground">{data.length} orders</span>
      </div>
      <DataTable columns={columns} data={data} rowHref={(r) => r.href} isStale={(r) => r.stale} globalFilter={q} density="compact" className="rounded-t-none" initialSorting={[{ id: "last", desc: false }]} emptyState={<EmptyState title="No orders match these filters" className="py-8" />} data-testid="orders-table" />
    </div>
  );
}
