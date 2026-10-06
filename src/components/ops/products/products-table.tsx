"use client";
import * as React from "react";
import { Search, AlertTriangle } from "lucide-react";
import type { ProductRow } from "@/server/ops/products";
import { PRODUCT_CATEGORIES, PRODUCT_VISIBILITIES, type ProductVisibility } from "@/db/enums";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table";
import { MediaCell } from "@/components/shared/media";
import { EmptyState } from "@/components/shared/empty-state";
import { UtilityBadge } from "@/components/shared/chips";
import { DateTime, Qty, UnitPrice } from "@/components/shared/formatters";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { label } from "@/lib/labels";

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
    { id: "name", accessorKey: "name", header: "Product", meta: { sticky: true }, cell: ({ row }) => <MediaCell image={row.original.image} size="lg" title={row.original.name} textWidth="max-w-[40ch]" sub={<>{row.original.ref}{row.original.category && <span className="font-sans"> · {label("productCategory", row.original.category)}</span>}</>} /> },
    { id: "owner", accessorKey: "ownerOrgName", header: "Owner org", cell: ({ row }) => row.original.ownerOrgName ?? <span className="text-faint">—</span> },
    { id: "visibility", accessorKey: "visibility", header: "Visibility", cell: ({ row }) => <VisibilityChip visibility={row.original.visibility} /> },
    {
      id: "price", accessorKey: "referencePriceMinorE2", header: "Reference price", meta: { numeric: true, strong: true },
      cell: ({ row }) => {
        const r = row.original;
        if (r.referencePriceMinorE2 == null) return <span className="font-sans text-xs text-muted-foreground">Not in catalog</span>;
        return (
          <div className="py-0.5">
            <UnitPrice minorE2={r.referencePriceMinorE2} currency={r.referenceCurrency} unit={r.unit} />
            <div className="flex items-center justify-end gap-1.5 font-sans text-xs text-muted-foreground">
              {r.referenceMoq != null && <span>MOQ <Qty qty={r.referenceMoq} /></span>}
              {r.referenceIncoterm && <span>· {r.referenceIncoterm} {r.referencePort}</span>}
              {r.referenceValidUntil && <span>· <ValidUntil value={r.referenceValidUntil} stale={r.priceStale} expiring={r.priceExpiring} /></span>}
            </div>
          </div>
        );
      },
    },
    { id: "spec", accessorKey: "referenceSpecVersion", header: "Spec", cell: ({ row }) => (row.original.referenceSpecVersion != null ? <span className="inline-flex items-center gap-1.5 whitespace-nowrap"><UtilityBadge kind="version">v{row.original.referenceSpecVersion}</UtilityBadge><span className="text-xs text-muted-foreground">of {row.original.specVersions}</span></span> : row.original.specVersions > 0 ? <span className="text-xs text-muted-foreground">{row.original.specVersions} {row.original.specVersions === 1 ? "version" : "versions"}</span> : <span className="text-xs text-muted-foreground">Draft</span>) },
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
      <DataTable columns={columns} data={data} rowHref={(r) => `/ops/products/${r.ref}`} initialSorting={[{ id: "name", desc: false }]} className="rounded-t-none" maxHeight="calc(100vh - 16rem)" data-testid="products-table"
        emptyState={<EmptyState title="No products match these filters" action={<Button variant="outline" onClick={clear}>Clear filters</Button>} className="py-8" />} />
    </div>
  );
}
