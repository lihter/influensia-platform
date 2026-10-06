"use client";
import * as React from "react";
import Link from "next/link";
import { Search, PackageSearch } from "lucide-react";
import type { ClientCatalogDto } from "@/server/client/dto";
import type { ClientCatalogCategoryDto, ClientCatalogRequestDto } from "@/server/client/dto/catalog";
import type { ClientRangeSummaryDto } from "@/server/client/dto/ranges";
import type { ActionResult } from "@/server/shared/http";
import { EmptyState } from "@/components/shared/empty-state";
import { FactoryLabel } from "@/components/shared/factory-label";
import { UnitPrice } from "@/components/shared/formatters";
import { fmtDateShort } from "@/lib/format-date";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { label } from "@/lib/labels";
import { PageBand } from "@/components/shared/section-band";
import { referenceMeta } from "./catalog-card";
import { DataTable, CellSub, type DataTableColumn } from "@/components/shared/data-table";
import { UtilityBadge } from "@/components/shared/chips";
import { MediaCell, ProductThumb } from "@/components/shared/media";
import { perUnit } from "../client-format";
import { RequestOfferForm } from "./request-offer-form";

type Action = (i: { productRef: string; qty: number; note?: string | null }) => Promise<ActionResult<ClientCatalogRequestDto>>;

/**
 * Suggestions from Influensia: search + category chips on a section-alt band, then one table row per product — big
 * picture first, name, reference price, "Request offer". Rows keep the `catalog-card` hook for the anonymity crawl.
 */
export function CatalogGrid({ products, categories, action }: { products: ClientCatalogDto[]; categories: ClientCatalogCategoryDto[]; action: Action }) {
  const [q, setQ] = React.useState("");
  const [cat, setCat] = React.useState<string | null>(null);
  const [orderedOnly, setOrderedOnly] = React.useState(false);
  const n = q.trim().toLowerCase();
  const list = products.filter((p) => (!cat || p.category === cat) && (!orderedOnly || p.orderedBefore) && (!n || `${p.name} ${p.ref} ${p.category ?? ""}`.toLowerCase().includes(n)));
  const chip = (on: boolean) => cn("h-8 rounded-full border px-3 text-sm font-medium transition-colors duration-[120ms]", on ? "border-green-200 bg-green-100 text-green-700" : "border-border bg-card text-ink-2 hover:bg-surface-sunken");
  const columns = React.useMemo<DataTableColumn<ClientCatalogDto>[]>(() => [
    {
      id: "product", header: "Product", accessorFn: (p) => p.name,
      cell: ({ row: { original: p } }) => (
        <MediaCell
          image={p.image} name={p.name} size="xl" variant="comfortable" textWidth="max-w-[44ch]"
          title={<Link href={`/app/catalog/${p.ref}`} className="hover:underline" title={p.name} onClick={(e) => e.stopPropagation()}>{p.name}</Link>}
          sub={<>{p.category && <span className="font-sans">{label("productCategory", p.category)} · </span>}{p.ref}</>}
          extra={p.orderedBefore && <UtilityBadge kind="repeat" className="mt-1 normal-case tracking-normal">Ordered before</UtilityBadge>}
        />
      ),
      meta: { sticky: true },
    },
    {
      id: "price", header: "Reference price", accessorFn: (p) => p.referencePrice?.minorE2 ?? -1,
      cell: ({ row: { original: p } }) => (
        <div className="text-right">
          {p.referencePrice && !p.priceStale
            ? <UnitPrice minorE2={p.referencePrice.minorE2} currency={p.referencePrice.currency} unit={perUnit(p.unit)} className="text-[15px]" />
            : <span className="text-sm font-medium text-ink-2" data-testid="price-tbc">price to be confirmed</span>}
          <CellSub className="text-right">{referenceMeta(p)}</CellSub>
        </div>
      ),
      meta: { numeric: true, strong: true },
    },
    { id: "action", header: "", enableSorting: false, cell: ({ row: { original: p } }) => <div onClick={(e) => e.stopPropagation()} className="flex justify-end"><RequestOfferForm p={p} action={action} /></div>, meta: { className: "w-px" } },
  ], [action]);

  return (
    <>
      <PageBand tone="alt" pad="sm" className="flex flex-wrap items-center gap-2" data-testid="catalog-filters">
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products" className="h-9 bg-card pl-8" aria-label="Search products" />
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Category">
          <button type="button" className={chip(cat === null)} aria-pressed={cat === null} onClick={() => setCat(null)}>All <span className="font-mono text-xs">{products.length}</span></button>
          {categories.map((c) => <button key={c.category} type="button" className={chip(cat === c.category)} aria-pressed={cat === c.category} onClick={() => setCat(cat === c.category ? null : c.category)}>{label("productCategory", c.category)} <span className="font-mono text-xs">{c.count}</span></button>)}
        </div>
        {products.some((p) => p.orderedBefore) && <button type="button" className={cn(chip(orderedOnly), "sm:ml-auto")} aria-pressed={orderedOnly} onClick={() => setOrderedOnly((x) => !x)}>Ordered before</button>}
      </PageBand>
      <PageBand tone="page" pad="lg">
        {products.length === 0 ? (
          <div className="rounded-xl border border-border bg-card">
            <EmptyState icon={PackageSearch} title="Our suggestions are being prepared." body="Send a request and we'll source it." action={<Button asChild><Link href="/app/requests/new">New request</Link></Button>} />
          </div>
        ) : (
          <DataTable
            columns={columns}
            data={list}
            rowHref={(p) => `/app/catalog/${p.ref}`}
            rowProps={(p) => ({ "data-testid": "catalog-card", "data-ref": p.ref })}
            data-testid="catalog-grid"
            emptyState={<EmptyState title="No products match" action={<Button variant="outline" onClick={() => { setQ(""); setCat(null); setOrderedOnly(false); }}>Clear filters</Button>} />}
          />
        )}
      </PageBand>
    </>
  );
}

/** Catalogues: one row per published range — picture, catalogue name, how many items, what of yours it makes, PDF. */
export function RangesList({ ranges }: { ranges: ClientRangeSummaryDto[] }) {
  if (!ranges.length) {
    return <div className="rounded-xl border border-border bg-card"><EmptyState icon={PackageSearch} title="No catalogues yet" body="When a maker we work with for you has more to offer, its full catalogue appears here — with prices, ready to quote." /></div>;
  }
  return (
    <ul className="flex flex-col gap-3" data-testid="catalog-ranges">
      {ranges.map((r) => (
        <li key={r.id} className="relative flex items-center gap-4 rounded-xl border border-border bg-card p-4 transition-colors duration-[120ms] hover:bg-surface-sunken" data-testid="range-card" data-label={r.factoryLabel}>
          <ProductThumb image={r.image} name={r.displayName ?? r.factoryLabel} size="xl" preview={false} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Link href={r.href} className="text-base font-semibold text-foreground after:absolute after:inset-0 after:content-['']" data-testid="range-title">{r.displayName ?? `Catalogue ${r.factoryLabel}`}</Link>
              <FactoryLabel label={r.factoryLabel} />
            </div>
            <p className="mt-1 text-sm text-ink-2">
              <span className="font-mono text-xs text-muted-foreground">{r.itemCount} items · updated {fmtDateShort(r.publishedAt)}</span>
              {r.yourProducts.length > 0 && <> · makes your <span className="font-medium text-foreground">{r.yourProducts.slice(0, 2).join(", ")}{r.yourProducts.length > 2 ? ` +${r.yourProducts.length - 2}` : ""}</span></>}
            </p>
            <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
              {r.preview.slice(0, 4).map((it) => <li key={it.name} className="max-w-[24ch] truncate">{it.name}{it.price && <> · <UnitPrice minorE2={it.price.minorE2} currency={it.price.currency} unit={it.price.unit} className="text-xs font-normal text-ink-2" /></>}</li>)}
            </ul>
          </div>
          <Button asChild variant="outline" size="sm" className="relative z-10 hidden sm:inline-flex"><Link href={r.href}>Open catalogue</Link></Button>
        </li>
      ))}
    </ul>
  );
}
