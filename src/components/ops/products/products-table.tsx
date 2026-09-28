"use client";
import * as React from "react";
import { Search, AlertTriangle } from "lucide-react";
import type { ProductRow } from "@/server/ops/products";
import { PRODUCT_CATEGORIES, PRODUCT_VISIBILITIES, type ProductVisibility } from "@/db/enums";
import { DataTable, PrimaryCell, type DataTableColumn } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { UtilityBadge } from "@/components/shared/chips";
import { DateTime, Qty, UnitPrice } from "@/components/shared/formatters";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

const ALL = "__all__";
export const VISIBILITY_LABEL: Record<ProductVisibility, string> = { private: "Private", catalog: "Catalog", proposed: "Proposed" };

export function VisibilityChip({ visibility, className }: { visibility: ProductVisibility; className?: string }) {
  return <Badge variant={visibility === "catalog" ? "success" : visibility === "proposed" ? "info" : "neutral"} className={className} data-visibility={visibility}>{VISIBILITY_LABEL[visibility]}</Badge>;
}

export function ValidUntil({ value, stale, expiring, className }: { value: string | null; stale: boolean; expiring: boolean; className?: string }) {
  if (!value) return <span className="text-faint">—</span>;
  return <span className={cn("inline-flex items-center gap-1", stale ? "text-danger" : expiring ? "text-warning" : "", className)} title={stale ? "Reference price expired" : expiring ? "Expires within 30 days" : undefined}>{(stale || expiring) && <AlertTriangle className="size-3" />}<DateTime value={value} variant="short" /></span>;
}

/** DESIGN §6.12 products list. */
export function ProductsTable({ rows, owners }: { rows: ProductRow[]; owners: { id: string; name: string }[] }) {
  const [q, setQ] = React.useState("");
  const [visibility, setVisibility] = React.useState<ProductVisibility | "">("");
  const [category, setCategory] = React.useState("");
  const [owner, setOwner] = React.useState("");
  const [expiring, setExpiring] = React.useState(false);
  const data = React.useMemo(() => {
    const n = q.trim().toLowerCase();
    return rows.filter((r) => (!visibility || r.visibility === visibility) && (!category || r.category === category) && (!owner || r.ownerOrgName === owner) && (!expiring || r.priceStale || r.priceExpiring) && (!n || `${r.ref} ${r.name} ${r.category ?? ""} ${r.ownerOrgName ?? ""}`.toLowerCase().includes(n)));
  }, [rows, q, visibility, category, owner, expiring]);
  const clear = () => { setQ(""); setVisibility(""); setCategory(""); setOwner(""); setExpiring(false); };

  const columns: DataTableColumn<ProductRow>[] = [
    { id: "ref", accessorKey: "ref", header: "Ref", meta: { sticky: true, width: "6.5rem" }, cell: ({ row }) => <span className="font-mono text-xs">{row.original.ref}</span> },
    { id: "name", accessorKey: "name", header: "Name", cell: ({ row }) => <PrimaryCell title={row.original.name} sub={row.original.category ?? undefined} className="max-w-[40ch]" /> },
    { id: "owner", accessorKey: "ownerOrgName", header: "Owner org", cell: ({ row }) => row.original.ownerOrgName ?? <span className="text-faint">—</span> },
    { id: "visibility", accessorKey: "visibility", header: "Visibility", cell: ({ row }) => <VisibilityChip visibility={row.original.visibility} /> },
    { id: "price", accessorKey: "referencePriceMinorE2", header: "Reference", meta: { numeric: true, strong: true }, cell: ({ row }) => (row.original.referencePriceMinorE2 != null ? <UnitPrice minorE2={row.original.referencePriceMinorE2} currency={row.original.referenceCurrency} unit={row.original.unit} /> : <span className="text-faint">—</span>) },
    { id: "moq", accessorKey: "referenceMoq", header: "At MOQ", meta: { numeric: true }, cell: ({ row }) => (row.original.referenceMoq != null ? <Qty qty={row.original.referenceMoq} unit={row.original.unit} /> : <span className="text-faint">—</span>) },
    { id: "incoterm", accessorFn: (r) => `${r.referenceIncoterm ?? ""} ${r.referencePort ?? ""}`, header: "Incoterm / port", cell: ({ row }) => (row.original.referenceIncoterm ? <span>{row.original.referenceIncoterm} <span className="text-ink-2">{row.original.referencePort}</span></span> : <span className="text-faint">—</span>) },
    { id: "spec", accessorKey: "referenceSpecVersion", header: "Spec", meta: { className: "text-center" }, cell: ({ row }) => <span className="inline-flex items-center gap-1">{row.original.referenceSpecVersion != null ? <UtilityBadge kind="version">v{row.original.referenceSpecVersion}</UtilityBadge> : <span className="text-faint">—</span>}<span className="font-mono text-2xs text-muted-foreground">/{row.original.specVersions}</span></span> },
    { id: "valid", accessorKey: "referenceValidUntil", header: "Valid until", meta: { numeric: true }, cell: ({ row }) => <ValidUntil value={row.original.referenceValidUntil} stale={row.original.priceStale} expiring={row.original.priceExpiring} /> },
    { id: "lines", accessorKey: "linesCount", header: "Lines", meta: { numeric: true } },
    { id: "orders", accessorKey: "ordersCount", header: "Orders", meta: { numeric: true } },
    { id: "published", accessorKey: "publishedAt", header: "Published", meta: { numeric: true }, cell: ({ row }) => (row.original.publishedAt ? <DateTime value={row.original.publishedAt} variant="short" /> : <span className="text-faint">—</span>) },
  ];

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center gap-2 rounded-t-xl border border-b-0 border-border bg-section-alt px-4 py-3" data-testid="products-toolbar">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search ref, name, category" className="h-8 w-64 bg-card pl-8 text-[0.8125rem]" aria-label="Search products" />
        </div>
        <Select value={visibility || ALL} onValueChange={(v) => setVisibility(v === ALL ? "" : (v as ProductVisibility))}>
          <SelectTrigger size="sm" className="bg-card" aria-label="Visibility"><SelectValue placeholder="Visibility" /></SelectTrigger>
          <SelectContent><SelectItem value={ALL}>All visibilities</SelectItem>{PRODUCT_VISIBILITIES.map((v) => <SelectItem key={v} value={v}>{VISIBILITY_LABEL[v]}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={category || ALL} onValueChange={(v) => setCategory(v === ALL ? "" : v)}>
          <SelectTrigger size="sm" className="bg-card" aria-label="Category"><SelectValue placeholder="Category" /></SelectTrigger>
          <SelectContent><SelectItem value={ALL}>All categories</SelectItem>{PRODUCT_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={owner || ALL} onValueChange={(v) => setOwner(v === ALL ? "" : v)}>
          <SelectTrigger size="sm" className="bg-card" aria-label="Owner org"><SelectValue placeholder="Owner org" /></SelectTrigger>
          <SelectContent><SelectItem value={ALL}>All owners</SelectItem>{owners.map((o) => <SelectItem key={o.id} value={o.name}>{o.name}</SelectItem>)}</SelectContent>
        </Select>
        <Button type="button" size="sm" variant={expiring ? "secondary" : "ghost"} aria-pressed={expiring} onClick={() => setExpiring((x) => !x)}>Reference price expiring</Button>
        <span className="ml-auto font-mono text-xs text-muted-foreground" data-testid="products-count">{data.length} of {rows.length}</span>
        {(q || visibility || category || owner || expiring) && <Button type="button" size="sm" variant="ghost" onClick={clear}>Clear</Button>}
      </div>
      <DataTable columns={columns} data={data} rowHref={(r) => `/ops/products/${r.ref}`} initialSorting={[{ id: "ref", desc: false }]} className="rounded-t-none" maxHeight="calc(100vh - 16rem)" data-testid="products-table"
        emptyState={<EmptyState title="No products match these filters" action={<Button variant="outline" onClick={clear}>Clear filters</Button>} className="py-8" />} />
    </div>
  );
}
