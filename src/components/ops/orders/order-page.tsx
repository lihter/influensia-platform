import Link from "next/link";
import { useTranslations } from "next-intl";
import type { OpsOrderDetail } from "@/server/ops/orders";
import { formatMoney } from "@/server/shared/money";
import { fmtDate, fmtDateShort } from "@/lib/format-date";
import { label as labelOf, nextStepLabel } from "@/lib/labels";
import { PageBand } from "@/components/shared/section-band";
import { EyebrowLink } from "@/components/shared/page-header";
import { OnThisPage } from "./on-this-page";
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


/** DESIGN §6.10 — sticky header, stepper with internal sub-state, waiting card, facts strip, then 01–08 stacked sections with a sticky "On this page" rail. */
export function OpsOrderPage({ d }: { d: OpsOrderDetail }) {
  const o = d.order;
  const ts = useTranslations("state");
  const tm = useTranslations("milestone");
  const waitingItems: WaitingItem[] = o.waiting.party === "none" ? [] : [{
    id: "w", title: nextStepLabel(o.waiting.reason),
    context: o.waiting.party === "client" ? `Waiting on ${o.orgName} since ${fmtDate(o.lastChangeAt)}` : `Our move since ${fmtDate(o.lastChangeAt)}${o.stale ? " · stale" : ""}`,
    // one primary per screen: the header carries the stage action, the card only says what is waiting
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
        crumbs={[{ href: "/ops/orders", label: "Orders" }, { label: <span className="font-mono">{o.ref}</span> }]}
        eyebrow={<span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1"><span className="font-mono">{o.ref}</span>·<EyebrowLink href={`/ops/clients/${o.orgId}`}>{o.orgName}</EyebrowLink>·<EyebrowLink href={`/ops/requests/${o.requestRef}`} className="font-mono">{o.requestRef}</EyebrowLink></span>}
        title={o.name}
        meta={<>
          <StateChip state={o.state} stale={o.stale} />
          {tm(o.milestone).toLowerCase() !== ts(o.state).toLowerCase() && <MilestoneChip milestone={o.milestone} waitingOnClient={o.waiting.party === "client"} showStep={o.milestoneStep} />}
          {o.exception && <ExceptionChip exception={o.exception} />}
          <span className="h-4 w-px bg-border" aria-hidden />
          <span className="text-xs text-ink-2">{COMMERCIAL_MODE[o.commercialMode]} · {PRICING_DISPLAY[o.pricingDisplay]}</span>
          {o.piNumber && <Ref muted>{o.piNumber}</Ref>}
          {o.incoterm && <span className="text-xs whitespace-nowrap text-muted-foreground">{o.incoterm}{o.port ? ` ${o.port}` : ""}</span>}
          {o.agentName && <span className="text-xs whitespace-nowrap text-muted-foreground">· {o.agentName}</span>}
          <span className="text-xs whitespace-nowrap text-muted-foreground">· last change <Age since={o.lastChangeAt} stale={o.stale} /></span>
        </>}
        actions={<OrderHeaderActions d={d} />}
      />
      {/* NOW zone: where the order stands and what is waiting — white band under the header */}
      <PageBand tone="white" pad="md" className="border-t border-hairline-faint">
        <div className="flex flex-col gap-5">
          <div data-testid="stepper-card">
            <MilestoneStepper milestone={o.milestone} waitingOnClient={o.waiting.party === "client"} sampleSkipped={o.sampleSkipped} />
          </div>
          <div className="grid gap-4 xl:grid-cols-[minmax(0,22rem)_1fr]">
            <WaitingOnYouCard items={waitingItems} tone={o.waiting.party === "client" ? "neutral" : "agency"} emptyTitle="Nothing is waiting" emptyHint="The order is closed." className="p-4" />
            <FactsStrip
              columns={4}
              facts={[
                { label: "Quantity", value: d.lines.length === 1 ? <Qty qty={d.lines[0].qty} unit={d.lines[0].unit} /> : `${d.lines.length} lines`, sub: d.lines.length === 1 && d.lines[0].specVersion ? `spec v${d.lines[0].specVersion}` : undefined },
                { label: "Unit price", value: d.lines.length === 1 ? <UnitPrice minorE2={d.lines[0].unitPriceMinorE2} currency={o.currency} unit={d.lines[0].unit} size="lg" /> : "—", sub: o.pricingDisplay === "factory_plus_fee" && fees ? `+ ${formatMoney({ minor: fees, currency: o.currency })} fee` : "all-in" },
                { label: "Total", value: <Money minor={o.totalMinor} currency={o.currency} strong />, sub: `goods ${formatMoney({ minor: goods, currency: o.currency })}${o.nextPayment ? ` · next ${labelOf("paymentKind", o.nextPayment.kind).toLowerCase()} ${formatMoney({ minor: o.nextPayment.amountMinor, currency: o.nextPayment.currency })}${o.nextPayment.dueOn ? ` due ${fmtDateShort(o.nextPayment.dueOn)}` : ""}` : " · paid in full"}` },
                { label: o.etaPort ? "ETA port" : "Ex-works ETA", value: o.etaPort ? <DateTime value={o.etaPort} /> : o.exworksEta ? <DateTime value={o.exworksEta} /> : "—", sub: o.etaPort ? `${o.portOfDischarge ?? "port"}${o.exworksEta ? ` · ex-works ${fmtDateShort(o.exworksEta)}` : ""}` : o.deliveredAt ? `delivered ${fmtDate(o.deliveredAt)}` : undefined },
              ]}
            />
          </div>
        </div>
      </PageBand>
      {/* 01–08 as distinct bands (alternating page / white) beside the full-height "On this page" alt rail */}
      <div className="grid border-t border-hairline-strong xl:grid-cols-[minmax(0,1fr)_15rem]">
        <div className="-mx-4 flex min-w-0 flex-col sm:-mx-6 xl:mr-0 [&>section:nth-child(even)]:bg-card [&>section]:border-b [&>section]:border-hairline-strong [&>section]:px-4 [&>section]:py-7 sm:[&>section]:px-6">
          <LinesSection d={d} />
          <PaymentsSection d={d} />
          <ArtworkSection d={d} />
          <PurchaseOrdersSection d={d} />
          <InspectionSection d={d} />
          <ShipmentSection d={d} />
          <DocumentsSection d={d} />
          <TimelineSection d={d} />
        </div>
        <aside className="hidden border-l border-hairline-strong bg-section-alt xl:-mr-6 xl:-mb-12 xl:block">
          <OnThisPage items={nav.map(([id, label], i) => ({ id, label, number: i + 1, open: openCounts[id] ?? 0 }))} />
        </aside>
      </div>
    </div>
  );
}

/** 01 Lines — qty, unit price, fee, factory price, supplier (internal), PO ref. */
function LinesSection({ d }: { d: OpsOrderDetail }) {
  const o = d.order;
  return (
    <section id="lines" className="scroll-under-header" aria-labelledby="lines-h" data-testid="section-lines">
      <SectionHeading number={1} title={<span id="lines-h">Lines</span>} action={<Badge variant="neutral">Internal — supplier column</Badge>} className="border-t-0 pt-0" />
      <div className="mt-4 scroll-shadow-x overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[46rem] table-fixed text-sm" data-testid="lines-table">
          <colgroup><col /><col className="w-[8.5rem]" /><col className="w-[9rem]" /><col className="w-[8rem]" /><col className="w-[15rem]" /></colgroup>
          <thead>
            <tr className="rule-ink text-left text-2xs font-semibold uppercase tracking-[0.06em] text-foreground">
              <th className="h-9 px-3">Line</th><th className="h-9 px-3 text-right">Qty</th><th className="h-9 px-3 text-right">Unit price · fee</th><th className="h-9 px-3 text-right">Factory price</th><th className="h-9 px-3">Supplier · PO</th>
            </tr>
          </thead>
          <tbody>
            {d.lines.map((l) => (
              <tr key={l.id} className="border-b border-hairline-faint last:border-b-0" data-testid="line-row">
                <td className="h-12 px-3 py-1.5"><div className="truncate font-medium text-foreground" title={l.name}>{l.name}</div><div className="truncate font-mono text-xs text-muted-foreground"><Link href={`/ops/lines/${l.lineRef}`} className="hover:underline">{l.lineRef}</Link>{l.specVersion ? ` · v${l.specVersion}` : ""}{l.clientSku ? ` · ${l.clientSku}` : ""}</div></td>
                <td className="px-3 text-right whitespace-nowrap"><Qty qty={l.qty} unit={l.unit} /></td>
                <td className="px-3 text-right whitespace-nowrap"><UnitPrice minorE2={l.unitPriceMinorE2} currency={o.currency} unit={l.unit} /><div className="font-mono text-xs text-muted-foreground">+ <Money minor={l.feeMinor} currency={o.currency} className="text-muted-foreground" /> fee</div></td>
                <td className="px-3 text-right whitespace-nowrap">{l.factoryUnitPriceMinorE2 !== null ? <UnitPrice minorE2={l.factoryUnitPriceMinorE2} currency={o.currency} unit={l.unit} className="font-normal text-ink-2" /> : <span className="text-faint">—</span>}</td>
                <td className="px-3">{l.supplierName ? <div className="min-w-0"><div className="truncate" title={l.supplierName}>{l.supplierName}</div><div className="truncate font-mono text-xs text-muted-foreground"><Link href={`/ops/suppliers/${l.supplierRef}`} className="hover:underline">{l.supplierRef}</Link>{l.poRef ? ` · ${l.poRef}` : ""}</div></div> : <span className="text-faint">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
