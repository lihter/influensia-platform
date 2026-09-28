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
import { CatalogCard, CatalogImage } from "./catalog-card";
import { RequestOfferForm } from "./request-offer-form";

type Action = (i: { productRef: string; qty: number; note?: string | null }) => Promise<ActionResult<ClientCatalogRequestDto>>;

/** DESIGN §6.5: search in the header slot, category chips + "Ordered before" on a section-alt band, 1/2/3-column grid. */
export function CatalogGrid({ products, categories, ranges, action }: { products: ClientCatalogDto[]; categories: ClientCatalogCategoryDto[]; ranges: ClientRangeSummaryDto[]; action: Action }) {
  const [q, setQ] = React.useState("");
  const [cat, setCat] = React.useState<string | null>(null);
  const [orderedOnly, setOrderedOnly] = React.useState(false);
  const n = q.trim().toLowerCase();
  const list = products.filter((p) => (!cat || p.category === cat) && (!orderedOnly || p.orderedBefore) && (!n || `${p.name} ${p.ref} ${p.category ?? ""}`.toLowerCase().includes(n)));
  const chip = (on: boolean) => cn("h-8 rounded-full border px-3 text-sm font-medium transition-colors duration-[120ms]", on ? "border-green-200 bg-green-100 text-green-700" : "border-border bg-card text-ink-2 hover:bg-surface-sunken");

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
          <EmptyState icon={PackageSearch} title="Our catalog is being prepared." body="Send a request and we'll source it." action={<Button asChild><Link href="/app/requests/new">New request</Link></Button>} />
        </div>
      ) : list.length === 0 ? (
        <div className="rounded-xl border border-border bg-card"><EmptyState title="No products match" action={<Button variant="outline" onClick={() => { setQ(""); setCat(null); setOrderedOnly(false); }}>Clear filters</Button>} /></div>
      ) : (
        <ul className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3" data-testid="catalog-grid">
          {list.map((p) => (
            <li key={p.id} className="min-w-0">
              <CatalogCard p={p} href={`/app/catalog/${p.ref}`} action={<RequestOfferForm p={p} action={action} className="w-full" />} />
            </li>
          ))}
        </ul>
      )}

      </PageBand>
      {ranges.length > 0 && (
        <PageBand tone="alt" pad="lg" aria-labelledby="ranges-h" data-testid="catalog-ranges">
          <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
            <h2 id="ranges-h" className="text-lg font-semibold">More from your factories</h2>
            <span className="text-xs text-muted-foreground">Other items the factories making your products can supply — quick quotes, no new sourcing round.</span>
          </div>
          <ul className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            {ranges.map((r) => (
              <li key={r.id} className="flex overflow-hidden rounded-xl border border-border bg-card" data-testid="range-card" data-label={r.factoryLabel}>
                <CatalogImage image={r.image} name={`Factory ${r.factoryLabel}`} className="hidden w-32 shrink-0 sm:block aspect-auto" />
                <div className="flex min-w-0 flex-1 flex-col p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <FactoryLabel label={r.factoryLabel} />
                    <span className="font-mono text-xs text-muted-foreground">{r.itemCount} items</span>
                    <span className="ml-auto text-xs text-muted-foreground">published {fmtDateShort(r.publishedAt)}</span>
                  </div>
                  <p className="mt-2 text-sm text-ink-2">{r.yourProducts.length ? <>The factory making your <span className="font-medium text-foreground">{r.yourProducts.slice(0, 2).join(", ")}{r.yourProducts.length > 2 ? ` +${r.yourProducts.length - 2}` : ""}</span>{r.orderRefs.length > 0 && <span className="font-mono text-xs text-muted-foreground"> · {r.orderRefs.join(", ")}</span>}</> : "A factory already working for you."}</p>
                  <ul className="mt-2 flex flex-col gap-0.5 text-xs text-muted-foreground">
                    {r.preview.slice(0, 3).map((it) => <li key={it.name} className="flex justify-between gap-3"><span className="truncate">{it.name}</span>{it.price && <span className="shrink-0">from <UnitPrice minorE2={it.price.minorE2} currency={it.price.currency} unit={it.price.unit} className="text-xs font-normal text-ink-2" /></span>}</li>)}
                    {r.itemCount > Math.min(3, r.preview.length) && <li className="text-faint">+{r.itemCount - Math.min(3, r.preview.length)} more</li>}
                  </ul>
                  <div className="mt-3"><Button asChild variant="outline" size="sm"><Link href={r.href}>See all {r.itemCount} items</Link></Button></div>
                </div>
              </li>
            ))}
          </ul>
        </PageBand>
      )}
    </>
  );
}
