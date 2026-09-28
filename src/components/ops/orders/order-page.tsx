import Link from "next/link";
import { useTranslations } from "next-intl";
import type { OpsOrderDetail } from "@/server/ops/orders";
import { formatMoney } from "@/server/shared/money";
import { formatDate } from "@/server/shared/dates";
import { PageHeader } from "@/components/shared/page-header";
import { StateChip, MilestoneChip, ExceptionChip } from "@/components/shared/chips";
import { MilestoneStepper } from "@/components/shared/milestone-stepper";
import { WaitingOnYouCard, type WaitingItem } from "@/components/shared/waiting-on-you-card";
import { FactsStrip } from "@/components/shared/facts-strip";
import { SectionHeading } from "@/components/shared/section-band";
import { Money, UnitPrice, Qty, Ref, Age, DateTime } from "@/components/shared/formatters";
import { Badge } from "@/components/ui/badge";
import { OrderHeaderActions } from "./order-header-actions";
import { PaymentsSection } from "./sections/payments";
import { ArtworkSection } from "./sections/artwork";
import { PurchaseOrdersSection } from "./sections/purchase-orders";
import { InspectionSection } from "./sections/inspection";
import { ShipmentSection } from "./sections/shipment";
import { DocumentsSection } from "./sections/documents";
import { TimelineSection } from "./sections/timeline";
import { COMMERCIAL_MODE, PRICING_DISPLAY } from "./strings";

const REASON: Record<string, string> = {
  offer_sent: "Offer sent", sample_received: "Sample received", deposit_due: "Deposit + fee due", artwork_due: "Artwork due", balance_due: "Balance due", delivery_confirm: "Confirm delivery", needs_input: "Needs input",
  offer_followup: "Offer follow-up", sample_in_progress: "Sample in progress", advance_state: "Advance the state", artwork_review: "Review the artwork",
};

/** DESIGN §6.10 — sticky header, stepper with internal sub-state, waiting card, facts strip, then 01–08 stacked sections with a sticky "On this page" rail. */
export function OpsOrderPage({ d }: { d: OpsOrderDetail }) {
  const o = d.order;
  const tw = useTranslations("waiting.ops.reason");
  const ts = useTranslations("state");
  const waitingItems: WaitingItem[] = o.waiting.party === "none" ? [] : [{
    id: "w", title: tw.has(o.waiting.reason) ? tw(o.waiting.reason as never) : ts.has(o.waiting.reason) ? ts(o.waiting.reason as never) : REASON[o.waiting.reason] ?? o.waiting.reason.replace(/_/g, " "),
    context: o.waiting.party === "client" ? `Waiting on ${o.orgName} since ${formatDate(o.lastChangeAt)}` : `Our move since ${formatDate(o.lastChangeAt)}${o.stale ? " · stale" : ""}`,
    action: o.primaryAction ? { label: o.primaryAction.label, href: o.primaryAction.anchor } : { label: "Timeline", href: "#timeline" },
  }];
  const goods = d.lines.reduce((s, l) => s + Math.round((l.qty * l.unitPriceMinorE2) / 100), 0);
  const fees = d.lines.reduce((s, l) => s + l.feeMinor, 0);
  const openCounts: Record<string, number> = {
    lines: 0,
    payments: d.payments.filter((p) => p.status === "pending").length,
    artwork: d.artworks.filter((a) => a.artworkRequired && a.current?.status === "submitted").length,
    "purchase-orders": d.purchaseOrders.filter((p) => !p.exworksEta).length,
    inspection: d.inspections.filter((i) => !i.result).length,
    shipment: 0,
    documents: d.documents.filter((x) => x.visibility === "internal" && x.publishable).length,
    timeline: d.timeline.filter((e) => e.kind === "question").length,
  };
  const nav = [["lines", "Lines"], ["payments", "Payments"], ["artwork", "Artwork"], ["purchase-orders", "Purchase orders"], ["inspection", "Inspection"], ["shipment", "Shipment"], ["documents", "Documents"], ["timeline", "Timeline"]] as const;

  return (
    <div data-zone="money" id="header">
      <PageHeader
        sticky
        eyebrow={<span className="inline-flex flex-wrap items-center gap-2">{o.ref} · {o.orgName} <Badge variant="neutral">{COMMERCIAL_MODE[o.commercialMode]}</Badge><Badge variant="neutral">{PRICING_DISPLAY[o.pricingDisplay]}</Badge></span>}
        title={o.name}
        titleSuffix={<Link href={`/ops/requests/${o.requestRef}`} className="hover:underline">{o.requestRef}</Link>}
        meta={<>
          <StateChip state={o.state} stale={o.stale} />
          <MilestoneChip milestone={o.milestone} waitingOnClient={o.waiting.party === "client"} showStep={o.milestoneStep} />
          {o.exception && <ExceptionChip exception={o.exception} />}
          {o.piNumber && <Ref muted>{o.piNumber}</Ref>}
          {o.incoterm && <span className="text-xs text-muted-foreground">{o.incoterm}{o.port ? ` ${o.port}` : ""}</span>}
          {o.agentName && <span className="text-xs text-muted-foreground">· {o.agentName}</span>}
          <span className="text-xs text-muted-foreground">· last change <Age since={o.lastChangeAt} stale={o.stale} /></span>
        </>}
        actions={<OrderHeaderActions d={d} />}
      />
      <div className="flex flex-col gap-4">
        <div className="rounded-xl border border-border bg-card p-5" data-testid="stepper-card">
          <MilestoneStepper milestone={o.milestone} state={o.state} waitingOnClient={o.waiting.party === "client"} sampleSkipped={o.sampleSkipped} />
        </div>
        <WaitingOnYouCard items={waitingItems} tone={o.waiting.party === "client" ? "neutral" : "agency"} emptyTitle="Nothing is waiting" emptyHint="The order is closed." />
        <FactsStrip
          columns={4}
          facts={[
            { label: "Quantity", value: d.lines.length === 1 ? <Qty qty={d.lines[0].qty} unit={d.lines[0].unit} /> : `${d.lines.length} lines`, sub: d.lines.length === 1 && d.lines[0].specVersion ? `spec v${d.lines[0].specVersion}` : undefined },
            { label: "Unit price", value: d.lines.length === 1 ? <UnitPrice minorE2={d.lines[0].unitPriceMinorE2} currency={o.currency} unit={d.lines[0].unit} size="lg" /> : "—", sub: o.pricingDisplay === "factory_plus_fee" && fees ? `+ ${formatMoney({ minor: fees, currency: o.currency })} fee` : "all-in" },
            { label: "Total", value: <Money minor={o.totalMinor} currency={o.currency} strong />, sub: `goods ${formatMoney({ minor: goods, currency: o.currency })}${o.nextPayment ? ` · next ${o.nextPayment.kind} ${formatMoney({ minor: o.nextPayment.amountMinor, currency: o.nextPayment.currency })}${o.nextPayment.dueOn ? ` due ${formatDate(o.nextPayment.dueOn, "d MMM")}` : ""}` : " · all paid"}` },
            { label: o.etaPort ? "ETA port" : "Ex-works ETA", value: o.etaPort ? <DateTime value={o.etaPort} /> : o.exworksEta ? <DateTime value={o.exworksEta} /> : "—", sub: o.etaPort ? `${o.portOfDischarge ?? "port"}${o.exworksEta ? ` · ex-works ${formatDate(o.exworksEta, "d MMM")}` : ""}` : o.deliveredAt ? `delivered ${formatDate(o.deliveredAt)}` : undefined },
          ]}
        />
        <div className="grid gap-6 xl:grid-cols-[1fr_16rem]">
          <div className="flex min-w-0 flex-col gap-4">
            <LinesSection d={d} />
            <PaymentsSection d={d} />
            <ArtworkSection d={d} />
            <PurchaseOrdersSection d={d} />
            <InspectionSection d={d} />
            <ShipmentSection d={d} />
            <DocumentsSection d={d} />
            <TimelineSection d={d} />
          </div>
          <aside className="hidden xl:block">
            <nav className="sticky top-24 rounded-xl border-l border-hairline-strong bg-section-alt px-4 py-4" aria-label="On this page" data-testid="page-nav">
              <div className="mb-2 eyebrow">On this page</div>
              <ol className="flex flex-col gap-0.5">
                {nav.map(([id, label], i) => (
                  <li key={id}>
                    <a href={`#${id}`} className="flex h-8 items-center gap-2 rounded-md px-2 text-sm text-ink-2 hover:bg-white/60 hover:text-foreground">
                      <span className="font-mono text-2xs text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
                      <span className="flex-1">{label}</span>
                      {openCounts[id] > 0 && <span className="font-mono text-2xs text-warning">{openCounts[id]}</span>}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
          </aside>
        </div>
      </div>
    </div>
  );
}

/** 01 Lines — qty, unit price, fee, factory price, supplier (internal), PO ref. */
function LinesSection({ d }: { d: OpsOrderDetail }) {
  const o = d.order;
  return (
    <section id="lines" className="scroll-mt-24 rounded-xl border border-border bg-card p-5" aria-labelledby="lines-h" data-testid="section-lines">
      <SectionHeading number={1} title={<span id="lines-h">Lines</span>} action={<Badge variant="neutral">Internal — supplier column</Badge>} className="border-t-0 pt-0" />
      <div className="mt-4 overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm" data-testid="lines-table">
          <thead>
            <tr className="rule-ink text-left text-2xs font-semibold uppercase tracking-[0.06em] text-foreground">
              <th className="h-9 px-3">Line</th><th className="h-9 px-3 text-right">Qty</th><th className="h-9 px-3 text-right">Unit price</th><th className="h-9 px-3 text-right">Fee</th><th className="h-9 px-3 text-right">Factory price</th><th className="h-9 px-3">Supplier</th><th className="h-9 px-3">PO</th>
            </tr>
          </thead>
          <tbody>
            {d.lines.map((l) => (
              <tr key={l.id} className="border-b border-hairline-faint last:border-b-0" data-testid="line-row">
                <td className="h-10 px-3"><div className="max-w-[32ch] truncate font-medium text-foreground">{l.name}</div><div className="font-mono text-xs text-muted-foreground"><Link href={`/ops/lines/${l.lineRef}`} className="hover:underline">{l.lineRef}</Link>{l.specVersion ? ` · v${l.specVersion}` : ""}{l.clientSku ? ` · ${l.clientSku}` : ""}</div></td>
                <td className="h-10 px-3 text-right"><Qty qty={l.qty} unit={l.unit} /></td>
                <td className="h-10 px-3 text-right"><UnitPrice minorE2={l.unitPriceMinorE2} currency={o.currency} unit={l.unit} /></td>
                <td className="h-10 px-3 text-right"><Money minor={l.feeMinor} currency={o.currency} /></td>
                <td className="h-10 px-3 text-right">{l.factoryUnitPriceMinorE2 !== null ? <UnitPrice minorE2={l.factoryUnitPriceMinorE2} currency={o.currency} unit={l.unit} className="font-normal text-ink-2" /> : <span className="text-faint">—</span>}</td>
                <td className="h-10 px-3">{l.supplierName ? <span className="inline-flex items-center gap-2"><span className="max-w-[24ch] truncate">{l.supplierName}</span><Link href={`/ops/suppliers/${l.supplierRef}`} className="font-mono text-xs text-muted-foreground hover:underline">{l.supplierRef}</Link></span> : <span className="text-faint">—</span>}</td>
                <td className="h-10 px-3 font-mono text-xs">{l.poRef ?? <span className="text-faint">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
