"use client";
import * as React from "react";
import Link from "next/link";
import { Check, Circle, Minus, Download, Search, Boxes, Package } from "lucide-react";
import type { ClientProductRowDto, ClientOrderRowDto, ClientOrderStepDto } from "@/server/client/dto/portal";
import { DataTable, CellSub, type DataTableColumn } from "@/components/shared/data-table";
import { MilestoneChip, ExceptionChip } from "@/components/shared/chips";
import { EmptyState } from "@/components/shared/empty-state";
import { Money, UnitPrice } from "@/components/shared/formatters";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { fmtDate, fmtDateShort } from "@/lib/format-date";
import { unitLabel } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { perUnit, nextStepFor } from "../client-format";
import { NextShort } from "../now-next";
import { ProductThumb, ThumbStack } from "../product-thumb";

/* ───────────────────────── shared bits ───────────────────────── */

export function TableSearch({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative w-full sm:w-72">
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} className="h-10 bg-card pl-8 sm:h-9" data-testid="table-search" />
    </div>
  );
}

function StatusChip({ r }: { r: { milestone: ClientProductRowDto["milestone"]; milestoneLabel: string; exception: ClientProductRowDto["exception"]; waitingReason: ClientProductRowDto["waitingReason"] } }) {
  return r.exception ? <ExceptionChip exception={r.exception} client /> : <MilestoneChip milestone={r.milestone} waitingOnClient={!!r.waitingReason} label={r.milestoneLabel} />;
}

const BASIS: Record<NonNullable<ClientProductRowDto["priceBasis"]>, string> = { ordered: "ordered", accepted: "accepted", offered: "offer" };

function ProductPrice({ r }: { r: ClientProductRowDto }) {
  if (!r.price) return <span className="text-xs text-muted-foreground">{r.milestone === "received" || r.milestone === "finding_factory" ? "Price coming" : "—"}</span>;
  return (
    <div className="text-right">
      <UnitPrice minorE2={r.price.minorE2} currency={r.price.currency} unit={perUnit(r.price.unit)} className="text-[15px]" />
      <CellSub className="text-right">
        {[r.incoterm ? `${r.incoterm}${r.port ? ` ${r.port}` : ""}` : null, r.fee ? "+ fee" : null, r.priceBasis ? BASIS[r.priceBasis] : null].filter(Boolean).join(" · ")}
      </CellSub>
    </div>
  );
}

const productStep = (r: ClientProductRowDto) => nextStepFor({ milestone: r.milestone, state: r.state, waitingReason: r.waitingReason, exception: r.exception, offerOutcome: r.offerOutcome, sourcing: r.sourcingProgress, since: r.lastChangeAt, isRepeat: r.isRepeat, etaLabel: r.etaLabel });

/* ───────────────────────── Products ───────────────────────── */

export function ProductsTable({ rows, compact, limit }: { rows: ClientProductRowDto[]; compact?: boolean; limit?: number }) {
  const [q, setQ] = React.useState("");
  const needle = q.trim().toLowerCase();
  const filtered = (needle ? rows.filter((r) => r.name.toLowerCase().includes(needle) || r.ref.toLowerCase().includes(needle) || (r.lastOrderRef ?? "").toLowerCase().includes(needle)) : rows).slice(0, limit ?? rows.length);
  const columns = React.useMemo<DataTableColumn<ClientProductRowDto>[]>(() => [
    {
      id: "product", header: "Product", accessorFn: (r) => r.name, enableSorting: true,
      cell: ({ row: { original: r } }) => (
        <div className="flex items-center gap-4 py-1.5">
          <ProductThumb image={r.image} name={r.name} domain={r.linkDomain} size={compact ? "md" : "lg"} />
          <div className="min-w-0 max-w-[30ch]">
            <Link href={r.href} className="block truncate text-[15px] font-medium leading-5 text-foreground hover:underline" title={r.name} onClick={(e) => e.stopPropagation()}>{r.name}</Link>
            <CellSub mono>{r.ref}{r.qty !== null ? ` · ${r.qty.toLocaleString("en-US")} ${unitLabel(r.unit, r.qty)}` : ""}</CellSub>
          </div>
        </div>
      ),
      meta: { sticky: true },
    },
    { id: "status", header: "Status", accessorFn: (r) => r.milestoneLabel, cell: ({ row: { original: r } }) => <StatusChip r={r} /> },
    { id: "next", header: "Next", enableSorting: false, cell: ({ row: { original: r } }) => { const st = productStep(r); return st.short ? <NextShort step={st} className="font-mono" /> : <span className="text-xs text-muted-foreground">—</span>; } },
    { id: "price", header: "Price", accessorFn: (r) => r.price?.minorE2 ?? -1, cell: ({ row: { original: r } }) => <ProductPrice r={r} />, meta: { numeric: true, strong: true } },
    ...(compact ? [] : [
      {
      id: "orders", header: "Orders", accessorFn: (r) => r.orderCount,
      cell: ({ row: { original: r } }) => r.orderCount ? (
        <div className="text-right">
          <span className="font-mono text-[13px] text-foreground">{r.orderCount}×</span>
          <CellSub mono className="text-right">{r.lastOrderRef}{r.lastOrderedAt ? ` · ${fmtDateShort(r.lastOrderedAt)}` : ""}</CellSub>
        </div>
      ) : <span className="text-xs text-muted-foreground">Not ordered yet</span>,
      meta: { numeric: true },
    } as DataTableColumn<ClientProductRowDto>]),
  ], [compact]);
  return (
    <div className="flex flex-col gap-3">
      {!compact && <TableSearch value={q} onChange={setQ} placeholder="Search products, refs, orders" />}
      {filtered.length > 0 && (
        <ul className="flex flex-col gap-2 md:hidden" data-testid="products-cards">
          {filtered.map((r) => {
            const st = productStep(r);
            return (
              <li key={r.id}>
                <Link href={r.href} className="flex gap-3 rounded-xl border border-border bg-card p-3 active:bg-surface-sunken">
                  <ProductThumb image={r.image} name={r.name} domain={r.linkDomain} size="xl" preview={false} />
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="line-clamp-2 text-[15px] font-medium leading-5 text-foreground">{r.name}</span>
                    <div><StatusChip r={r} /></div>
                    {r.price ? <UnitPrice minorE2={r.price.minorE2} currency={r.price.currency} unit={perUnit(r.price.unit)} className="text-sm" /> : null}
                    {st.short && <NextShort step={st} className="font-mono text-xs" />}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <DataTable
        className={filtered.length > 0 ? "hidden md:block" : undefined}
        columns={columns}
        data={filtered}
        rowHref={(r) => r.href}
        rowProps={(r) => ({ "data-testid": "product-row", "data-ref": r.ref })}
        stickyFirstColumn
        data-testid="products-table"
        emptyState={needle
          ? <EmptyState icon={Search} title="No product matches your search" action={<Button variant="outline" onClick={() => setQ("")}>Clear search</Button>} />
          : <EmptyState icon={Boxes} title="No products yet" body="Everything you ask us to source shows up here — with its picture and your price." action={<Button asChild><Link href="/app/requests/new">New request</Link></Button>} />}
      />
    </div>
  );
}

/* ───────────────────────── Orders ───────────────────────── */

const STEP_LABEL: Record<keyof ClientOrderRowDto["steps"], string> = { deposit: "Deposit", artwork: "Artwork", production: "Production", shipping: "Shipping", balance: "Balance", commission: "Service fee" };

function StepMark({ s, name }: { s: ClientOrderStepDto; name: string }) {
  const icon = s.status === "done"
    ? <span className="inline-flex size-6 items-center justify-center rounded-full bg-green-600 text-white"><Check className="size-3.5" strokeWidth={3} /></span>
    : s.status === "current"
      ? <span className="inline-flex size-6 items-center justify-center rounded-full border-2 border-warning-border bg-warning-wash"><Circle className="size-2 fill-warning text-warning" /></span>
      : s.status === "todo"
        ? <span className="inline-flex size-6 items-center justify-center rounded-full border border-hairline-strong bg-card" />
        : <span className="inline-flex size-6 items-center justify-center text-faint"><Minus className="size-3.5" /></span>;
  const text = s.status === "done" ? "Done" : s.status === "current" ? "In progress" : s.status === "todo" ? "Not yet" : "Not needed";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex min-w-[4.5rem] flex-col items-center gap-1" data-step={s.status} aria-label={`${name}: ${text}${s.detail ? ` — ${s.detail}` : ""}`}>
          {icon}
          <span className={cn("max-w-[6.5rem] truncate text-[11px] leading-3", s.status === "current" ? "font-medium text-warning" : "text-muted-foreground")}>{s.detail ?? (s.status === "na" ? "—" : "")}</span>
        </div>
      </TooltipTrigger>
      <TooltipContent>{name}: {text}{s.detail ? ` · ${s.detail}` : ""}</TooltipContent>
    </Tooltip>
  );
}

export function OrdersTable({ rows, compact, limit }: { rows: ClientOrderRowDto[]; compact?: boolean; limit?: number }) {
  const [q, setQ] = React.useState("");
  const needle = q.trim().toLowerCase();
  const filtered = (needle ? rows.filter((r) => r.ref.toLowerCase().includes(needle) || r.items.some((i) => i.name.toLowerCase().includes(needle))) : rows).slice(0, limit ?? rows.length);
  const stepCols = (Object.keys(STEP_LABEL) as (keyof ClientOrderRowDto["steps"])[]).map<DataTableColumn<ClientOrderRowDto>>((k) => ({
    id: k, header: STEP_LABEL[k], enableSorting: false,
    cell: ({ row: { original: r } }) => <StepMark s={r.steps[k]} name={STEP_LABEL[k]} />,
    meta: { className: "text-center [&>span]:justify-center px-1" },
  }));
  const columns: DataTableColumn<ClientOrderRowDto>[] = [
    {
      id: "order", header: "Order", accessorFn: (r) => r.placedAt, enableSorting: true,
      cell: ({ row: { original: r } }) => (
        <div className="flex items-center gap-4 py-1.5">
          <ThumbStack items={r.items} size={compact ? "md" : "lg"} />
          <div className="min-w-0 max-w-[26ch]">
            <Link href={r.href} className="block truncate text-[15px] font-medium leading-5 text-foreground hover:underline" onClick={(e) => e.stopPropagation()} title={r.items.map((i) => i.name).join(", ")}>
              {r.items[0]?.name ?? r.ref}{r.items.length > 1 ? <span className="font-normal text-muted-foreground"> + {r.items.length - 1} more</span> : null}
            </Link>
            <CellSub mono>{r.ref} · {fmtDate(r.placedAt)}</CellSub>
            <div className="mt-1">{r.exception ? <ExceptionChip exception={r.exception} client /> : <MilestoneChip milestone={r.milestone} waitingOnClient={!!r.waitingReason} label={r.milestoneLabel} />}</div>
          </div>
        </div>
      ),
      meta: { sticky: true },
    },
    { id: "total", header: "Total", accessorFn: (r) => r.total.minor, cell: ({ row: { original: r } }) => <Money minor={r.total.minor} currency={r.total.currency} strong />, meta: { numeric: true, strong: true } },
    ...(compact ? stepCols.filter((c) => c.id === "deposit" || c.id === "production" || c.id === "shipping" || c.id === "balance") : stepCols),
    {
      id: "invoice", header: "Invoice", enableSorting: false,
      cell: ({ row: { original: r } }) => r.invoice
        ? <Button asChild variant="outline" size="sm" onClick={(e) => e.stopPropagation()}><a href={r.invoice.downloadUrl} data-testid="invoice-download"><Download data-icon="inline-start" />{r.invoice.kind === "pi" ? "Proforma" : "Invoice"}</a></Button>
        : <span className="text-xs text-muted-foreground">Not issued yet</span>,
    },
  ];
  return (
    <div className="flex flex-col gap-3">
      {!compact && <TableSearch value={q} onChange={setQ} placeholder="Search orders and products" />}
      {filtered.length > 0 && (
        <ul className="flex flex-col gap-2 md:hidden" data-testid="orders-cards">
          {filtered.map((r) => (
            <li key={r.id} className="rounded-xl border border-border bg-card p-3">
              <Link href={r.href} className="flex gap-3">
                <ThumbStack items={r.items} size="lg" />
                <div className="min-w-0 flex-1">
                  <span className="line-clamp-2 text-[15px] font-medium leading-5 text-foreground">{r.items[0]?.name ?? r.ref}{r.items.length > 1 ? ` + ${r.items.length - 1} more` : ""}</span>
                  <CellSub mono>{r.ref} · {fmtDateShort(r.placedAt)} · <Money minor={r.total.minor} currency={r.total.currency} className="text-xs" /></CellSub>
                  <div className="mt-1">{r.exception ? <ExceptionChip exception={r.exception} client /> : <MilestoneChip milestone={r.milestone} waitingOnClient={!!r.waitingReason} label={r.milestoneLabel} />}</div>
                </div>
              </Link>
              <div className="mt-3 grid grid-cols-3 gap-y-3 border-t border-hairline-faint pt-3">
                {(Object.keys(STEP_LABEL) as (keyof ClientOrderRowDto["steps"])[]).map((k) => (
                  <div key={k} className="flex flex-col items-center gap-0.5">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">{STEP_LABEL[k]}</span>
                    <StepMark s={r.steps[k]} name={STEP_LABEL[k]} />
                  </div>
                ))}
              </div>
              {r.invoice && <Button asChild variant="outline" size="sm" className="mt-3 w-full"><a href={r.invoice.downloadUrl}><Download data-icon="inline-start" />{r.invoice.kind === "pi" ? "Proforma invoice" : "Invoice"}</a></Button>}
            </li>
          ))}
        </ul>
      )}
      <DataTable
        className={filtered.length > 0 ? "hidden md:block" : undefined}
        columns={columns}
        data={filtered}
        rowHref={(r) => r.href}
        rowProps={(r) => ({ "data-testid": "order-row", "data-ref": r.ref })}
        data-testid="orders-table"
        emptyState={needle
          ? <EmptyState icon={Search} title="No order matches your search" action={<Button variant="outline" onClick={() => setQ("")}>Clear search</Button>} />
          : <EmptyState icon={Package} title="No orders yet" body="When you accept a price we confirm the order here — deposit, production, shipping and invoices in one row." />}
      />
    </div>
  );
}

/** Small helper for sections: "All 12 products →". */
export function SeeAll({ href, label }: { href: string; label: string }) {
  return <Link href={href} className="link text-sm font-medium">{label} →</Link>;
}

