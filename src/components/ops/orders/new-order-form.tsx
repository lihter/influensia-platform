"use client";
import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import type { ConfirmContext } from "@/server/ops/orders";
import { COMMERCIAL_MODES, PRICING_DISPLAYS, INCOTERMS } from "@/db/enums";
import { formatMoney } from "@/server/shared/money";
import { StateChip } from "@/components/shared/chips";
import { Money, UnitPrice, Qty, Ref } from "@/components/shared/formatters";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createOrderAction } from "@/app/(ops)/ops/orders/actions";
import { Field } from "./ui";
import { COMMERCIAL_MODE, PRICING_DISPLAY, ERRORS } from "./strings";
import { cn } from "@/lib/utils";

/** SPEC F-22 "Confirm order" — checklist of accepted lines, incoterm/port, mode/display (D-10), PI number, deposit %, fee, artwork per line. */
export function NewOrderForm({ c }: { c: ConfirmContext }) {
  const eligible = c.lines.filter((l) => l.eligible);
  const [selected, setSelected] = React.useState<Set<string>>(new Set(eligible.map((l) => l.requestLineId)));
  const [artwork, setArtwork] = React.useState<Record<string, boolean>>(Object.fromEntries(c.lines.map((l) => [l.requestLineId, l.artworkRequired])));
  const [mode, setMode] = React.useState(c.defaults.commercialMode);
  const [display, setDisplay] = React.useState(c.defaults.pricingDisplay);
  const [incoterm, setIncoterm] = React.useState(c.defaults.incoterm);
  const [port, setPort] = React.useState(c.defaults.port ?? "");
  const [pi, setPi] = React.useState(c.defaults.piNumber);
  const [deposit, setDeposit] = React.useState(String(c.defaults.depositPct));
  const chosen = eligible.filter((l) => selected.has(l.requestLineId));
  const optionFees = chosen.reduce((s, l) => s + l.feeMinor, 0);
  // fee follows the selection until the agent edits it
  const [feeEdit, setFeeEdit] = React.useState<string | null>(null);
  const fee = feeEdit ?? (optionFees / 100).toFixed(2);
  const setFee = setFeeEdit;
  const [pending, start] = React.useTransition();
  const goods = chosen.reduce((s, l) => s + Math.round((l.qty * (l.unitPriceMinorE2 ?? 0)) / 100), 0);
  const feeMinor = Math.round(Number(fee.replace(/[,\s]/g, "")) * 100) || 0;
  const pct = Math.max(0, Math.min(100, Number(deposit) || 0));
  const dep = Math.round((goods * pct) / 100);
  const currency = chosen[0]?.currency ?? "USD";
  const incotermMismatch = new Set(chosen.map((l) => l.incoterm ?? "")).size > 1;

  const submit = () => start(async () => {
    const r = await createOrderAction({ requestId: c.requestId, lines: chosen.map((l) => ({ requestLineId: l.requestLineId, artworkRequired: !!artwork[l.requestLineId] })), commercialMode: mode, pricingDisplay: display, incoterm: incoterm as (typeof INCOTERMS)[number], port: port.trim() || null, piNumber: pi.trim() || null, depositPct: pct, feeMinor });
    if (r && !r.ok) toast.error(ERRORS[r.error] ?? r.error, r.errors ? { description: Object.values(r.errors).join(" · ") } : undefined);
  });

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_22rem]" data-testid="new-order-form">
      <div className="flex flex-col gap-4">
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-lg font-semibold">Lines</h2>
          <p className="mb-3 text-sm text-ink-2">Lines in <StateChip state="offer_accepted" /> with an accepted offer and a selected factory can be bundled. Others are shown for context.</p>
          <ul className="sheet">
            {c.lines.map((l) => (
              <li key={l.requestLineId} className={cn("sheet-row grid grid-cols-[auto_1fr_auto] items-center gap-3", !l.eligible && "opacity-60")} data-testid="confirm-line" data-eligible={l.eligible}>
                <input type="checkbox" className="size-4 accent-green-600" disabled={!l.eligible} checked={l.eligible && selected.has(l.requestLineId)} onChange={(e) => setSelected((s) => { const n = new Set(s); if (e.target.checked) n.add(l.requestLineId); else n.delete(l.requestLineId); return n; })} aria-label={`Include ${l.lineRef}`} />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2"><Ref muted>{l.lineRef}</Ref><StateChip state={l.state} />{l.offerRef && <span className="font-mono text-xs text-muted-foreground">{l.offerRef}{l.option ? `/${l.option}` : ""}</span>}</div>
                  <div className="truncate text-sm font-medium text-foreground">{l.name}</div>
                  <div className="text-xs text-ink-2">{l.supplierName ? <>{l.supplierName} <span className="font-mono text-muted-foreground">{l.supplierRef}</span></> : "no selected factory"} · {l.incoterm ?? "—"} {l.port ?? ""}</div>
                  {l.eligible && <label className="mt-1 flex items-center gap-1.5 text-xs text-ink-2"><input type="checkbox" className="accent-green-600" checked={!!artwork[l.requestLineId]} onChange={(e) => setArtwork((a) => ({ ...a, [l.requestLineId]: e.target.checked }))} />Artwork required</label>}
                </div>
                <div className="text-right text-sm">
                  <div><Qty qty={l.qty} unit={l.unit} /></div>
                  <div>{l.unitPriceMinorE2 !== null ? <UnitPrice minorE2={l.unitPriceMinorE2} currency={l.currency} unit={l.unit} /> : <span className="text-faint">no price</span>}</div>
                  <div className="text-xs text-ink-2">fee <Money minor={l.feeMinor} currency={l.currency} /></div>
                </div>
              </li>
            ))}
          </ul>
          {incotermMismatch && <p className="mt-2 text-xs text-warning">Selected lines have different incoterms — split them into two orders.</p>}
        </section>
        <section className="grid gap-4 rounded-xl border border-border bg-card p-5 md:grid-cols-2">
          <Field label="Commercial mode"><Select value={mode} onValueChange={(v) => setMode(v as typeof mode)}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{COMMERCIAL_MODES.map((m) => <SelectItem key={m} value={m}>{COMMERCIAL_MODE[m]}</SelectItem>)}</SelectContent></Select></Field>
          <Field label="Pricing display"><Select value={display} onValueChange={(v) => setDisplay(v as typeof display)}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{PRICING_DISPLAYS.map((m) => <SelectItem key={m} value={m}>{PRICING_DISPLAY[m]}</SelectItem>)}</SelectContent></Select></Field>
          <Field label="Incoterm"><Select value={incoterm} onValueChange={setIncoterm}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{INCOTERMS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent></Select></Field>
          <Field label="Port" htmlFor="port"><Input id="port" value={port} onChange={(e) => setPort(e.target.value)} placeholder="Shenzhen" /></Field>
          <Field label="PI number" htmlFor="pi"><Input id="pi" value={pi} onChange={(e) => setPi(e.target.value)} className="font-mono" /></Field>
          <Field label="Deposit %" htmlFor="deposit"><Input id="deposit" type="number" min={0} max={100} value={deposit} onChange={(e) => setDeposit(e.target.value)} className="font-mono text-right" /></Field>
          <Field label="Fee (USD, flat)" htmlFor="fee" hint={`Option fees total ${formatMoney({ minor: optionFees, currency })}`}><Input id="fee" value={fee} onChange={(e) => setFee(e.target.value)} className="font-mono text-right" /></Field>
        </section>
      </div>
      <aside className="xl:sticky xl:top-20 xl:self-start">
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="eyebrow">Order</div>
          <div className="mt-1 font-mono text-lg font-medium">{c.orderRef}</div>
          <div className="text-sm text-ink-2">{c.orgName} · {c.requestRef}</div>
          <dl className="mt-4 text-sm">
            {[["Goods", goods], ["Fee", feeMinor], ["Total", goods + feeMinor], [`Deposit ${pct} %`, dep], ["Balance", goods - dep]].map(([l, v]) => (
              <div key={String(l)} className={cn("flex justify-between border-b border-hairline-faint py-2 last:border-b-0", l === "Total" && "font-medium")}><dt className="text-ink-2">{l}</dt><dd><Money minor={Number(v)} currency={currency} strong={l === "Total"} /></dd></div>
            ))}
          </dl>
          <p className="mt-3 text-xs text-muted-foreground">Creates the order, its lines, deposit / fee / balance payments and one PO per factory; lines move to Order confirmed and the client is emailed. Then upload and publish the PI.</p>
          <Button className="mt-4 w-full" size="lg" disabled={pending || chosen.length === 0 || incotermMismatch} onClick={submit} data-testid="confirm-order">{pending && <Loader2 className="animate-spin" />}Confirm order</Button>
          <Button asChild variant="ghost" className="mt-2 w-full"><Link href={`/ops/requests/${c.requestRef}`}>Back to request</Link></Button>
        </div>
      </aside>
    </div>
  );
}
