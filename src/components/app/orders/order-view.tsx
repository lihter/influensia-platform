import Link from "next/link";
import { useTranslations } from "next-intl";
import { Factory, Download } from "lucide-react";
import type { ClientOrderPageDto } from "@/server/client/dto/orders";
import type { ClientDocumentDto } from "@/server/client/dto";
import { formatMoney } from "@/server/shared/money";
import { formatDate } from "@/server/shared/dates";
import { PageHeader } from "@/components/shared/page-header";
import { MilestoneStepper } from "@/components/shared/milestone-stepper";
import { WaitingOnYouCard, type WaitingItem } from "@/components/shared/waiting-on-you-card";
import { FactsStrip } from "@/components/shared/facts-strip";
import { ExceptionChip, PaymentStatusChip } from "@/components/shared/chips";
import { Timeline, type TimelineEntry } from "@/components/shared/timeline";
import { DocumentRow } from "@/components/shared/document-row";
import { EmptyState } from "@/components/shared/empty-state";
import { Money, UnitPrice, Qty, DateTime, Ref } from "@/components/shared/formatters";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AskSheet, UploadArtworkSheet, ConfirmDeliveryButton, ReorderSheet } from "./order-actions";
import { cn } from "@/lib/utils";

const ARTWORK: Record<string, string> = { submitted: "Submitted — under review", changes_requested: "Changes requested", approved: "Approved" };
const CUSTOMS: Record<string, string> = { not_started: "Not started", in_progress: "In progress", cleared: "Cleared", held: "Held" };
const MODE: Record<string, string> = { sea: "Sea", air: "Air", rail: "Rail" };

/**
 * DESIGN §6.3 — client order page: header (eyebrow ref · product, "Quality check · 7 of 9"), stepper, Waiting on you,
 * facts strip, Money / Artwork / Quality check / Shipping, tabs Updates · Documents · History, Confirm delivery / Reorder.
 * Receives ONLY the client DTO; `preview` (ops "Viewing as client") disables the actions.
 */
export function ClientOrderView({ dto, preview }: { dto: ClientOrderPageDto; preview?: boolean }) {
  const o = dto.order;
  const tm = useTranslations("milestone");
  const tk = useTranslations("payment_kind");
  const waitingOnClient = !!o.waitingReason;
  const nextPayment = o.payments.find((p) => p.status === "pending");
  const pi = o.documents.find((d) => d.kind === "pi") ?? null;
  const invoice = o.documents.find((d) => d.kind === "invoice") ?? null;
  const firstLine = o.lines[0];
  const fee = o.lines.reduce((s, l) => s + (l.fee?.minor ?? 0), 0);

  const primary = waitingOnClient ? primaryAction(dto, preview) : null;
  const waiting: WaitingItem[] = o.waitingReason ? [{
    id: o.waitingReason,
    title: o.waitingReason === "deposit_due" ? `Deposit ${money(o.payments, "deposit")}${money(o.payments, "fee") ? ` + fee ${money(o.payments, "fee")}` : ""} due` : o.waitingReason === "balance_due" ? `QC passed — balance ${money(o.payments, "balance")} due` : o.waitingReason === "artwork_due" ? (o.artworks.some((a) => a.status === "changes_requested") ? "Artwork changes requested" : "Upload your artwork") : o.waitingReason === "delivery_confirm" ? `Confirm you received ${o.ref}` : o.waitingReason === "needs_input" ? "We need your input" : "Your action",
    context: o.waitingReason === "balance_due" && o.inspection?.inspectedAt ? `QC passed on ${formatDate(o.inspection.inspectedAt)}${o.inspection.report ? " · report attached" : ""}` : o.waitingReason === "deposit_due" && o.piNumber ? `Invoice ${o.piNumber}` : o.waitingReason === "artwork_due" ? "PDF, AI, PNG or JPG — we check it against the dieline" : o.waitingReason === "delivery_confirm" && o.deliveredAt ? `Delivered ${formatDate(o.deliveredAt)}` : undefined,
    due: nextPayment?.dueOn && (o.waitingReason === "deposit_due" || o.waitingReason === "balance_due") ? `due ${formatDate(nextPayment.dueOn, "d MMM")}` : undefined,
    action: { label: primary?.label ?? "Open", href: primary?.href ?? "#" },
  }] : [];

  return (
    <div data-testid="client-order" data-ref={o.ref}>
      <PageHeader
        eyebrow={`${o.ref} · ${firstLine?.name ?? ""}`}
        title={o.name}
        titleSuffix={<span data-testid="milestone-suffix">{tm(o.milestone)} · {tm("stepOf", { step: o.milestoneStep })}</span>}
        meta={o.exception ? <ExceptionChip exception={o.exception} client /> : undefined}
        actions={<>
          <AskSheet orderRef={o.ref} disabled={preview} />
          {primary?.node}
        </>}
      />
      <div className="flex flex-col gap-6">
        <div className="rounded-xl border border-border bg-card p-5" data-testid="stepper-card">
          <MilestoneStepper milestone={o.milestone} subLabel={o.subLabel} waitingOnClient={waitingOnClient} sampleSkipped={o.sampleSkipped} />
        </div>
        {waiting.length > 0 && <WaitingOnYouCard items={waiting} />}
        <FactsStrip facts={[
          { label: "Quantity", value: firstLine ? <Qty qty={firstLine.qty} unit={firstLine.unit} /> : "—", sub: o.lines.length > 1 ? `${o.lines.length} lines` : firstLine?.specVersion ? `spec v${firstLine.specVersion}` : undefined },
          { label: "Price", value: firstLine ? <UnitPrice minorE2={firstLine.unitPrice.minorE2} currency={firstLine.unitPrice.currency} unit={firstLine.unit} size="lg" plusFee={o.pricingDisplay === "factory_plus_fee"} /> : "—", sub: o.pricingDisplay === "factory_plus_fee" ? `+ ${formatMoney({ minor: fee, currency: o.total.currency })} fee · total ${formatMoney(o.total)}` : `total ${formatMoney(o.total)}` },
          { label: o.deliveredAt ? "Delivered" : o.shipment?.etaPort && o.shipment.etd ? `ETA ${o.shipment.portOfDischarge ?? "port"}` : o.exworksEta ? "Ex-works ETA" : "ETA", value: o.deliveredAt ? <DateTime value={o.deliveredAt} /> : o.shipment?.etaPort && o.shipment.etd ? <DateTime value={o.shipment.etaPort} /> : o.exworksEta ? <DateTime value={o.exworksEta} /> : "—", sub: !o.deliveredAt && o.shipment?.etaPort && !o.shipment.etd ? `Planned ETA ${o.shipment.portOfDischarge ?? "port"} ${formatDate(o.shipment.etaPort)}` : o.incoterm ? `${o.incoterm}${o.port ? ` ${o.port}` : ""}` : undefined },
          { label: "Next payment", value: nextPayment ? <Money minor={nextPayment.amount.minor} currency={nextPayment.amount.currency} strong /> : "—", sub: nextPayment ? `${tk(nextPayment.kind)}${nextPayment.dueLabel ? ` · ${nextPayment.dueLabel}` : ""}` : "everything is paid" },
        ]} />

        {o.lines.length > 1 && (
          <Section id="lines" title="Lines">
            <ul className="sheet">
              {o.lines.map((l) => (
                <li key={l.id} className="sheet-row flex items-center gap-3 text-sm"><div className="min-w-0 flex-1"><div className="truncate font-medium">{l.name}</div><Ref muted>{l.lineRef}</Ref></div><Qty qty={l.qty} unit={l.unit} /><UnitPrice minorE2={l.unitPrice.minorE2} currency={l.unitPrice.currency} unit={l.unit} plusFee={!!l.fee} /></li>
              ))}
            </ul>
          </Section>
        )}

        {/* Money */}
        <Section id="payments" title="Money" action={pi ? <Button asChild variant="outline" size="sm"><a href={pi.downloadUrl} download data-testid="view-invoice"><Download />View invoice</a></Button> : undefined}>
          <div className="overflow-hidden rounded-xl border border-border">
            <table className="w-full text-sm" data-testid="payments-table">
              <thead><tr className="rule-ink text-left text-2xs font-semibold uppercase tracking-[0.06em] text-foreground"><th className="h-9 px-4">Payment</th><th className="h-9 px-4 text-right">Amount</th><th className="h-9 px-4">Status</th></tr></thead>
              <tbody>
                {o.payments.map((p) => (
                  <tr key={p.id} className="border-b border-hairline-faint last:border-b-0" data-testid="payment-row" data-kind={p.kind} data-status={p.status}>
                    <td className="h-11 px-4 font-medium">{tk(p.kind)}{p.pct !== null && <span className="ml-1 font-mono text-xs text-muted-foreground">{p.pct} %</span>}</td>
                    <td className="h-11 px-4 text-right"><Money minor={p.amount.minor} currency={p.amount.currency} strong /></td>
                    <td className="h-11 px-4">{p.status === "paid" ? <span className="inline-flex items-center gap-2"><PaymentStatusChip status="paid" /><span className="font-mono text-xs text-ink-2">{formatDate(p.paidAt)}</span></span> : p.status === "waived" ? <PaymentStatusChip status="waived" /> : <span className="inline-flex items-center gap-2"><PaymentStatusChip status="pending" />{p.dueLabel && <span className="font-mono text-xs text-ink-2">{p.dueLabel}</span>}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {invoice && <p className="mt-2 text-xs text-muted-foreground">Balance invoice: <a href={invoice.downloadUrl} className="link" download>{invoice.filename}</a></p>}
        </Section>

        {/* Artwork */}
        <Section id="artwork" title="Artwork">
          {o.lines.every((l) => !l.artworkRequired) && o.artworks.length === 0 ? (
            <p className="text-sm text-muted-foreground">No artwork needed for this order.</p>
          ) : (
            <ul className="sheet">
              {o.lines.filter((l) => l.artworkRequired || o.artworks.some((a) => a.lineRef === l.lineRef)).map((l) => {
                const a = o.artworks.find((x) => x.lineRef === l.lineRef) ?? null;
                const due = dto.artworkDue.find((x) => x.orderLineId === l.id);
                return (
                  <li key={l.id} className="sheet-row flex flex-col gap-2" data-testid="artwork-row" data-status={a?.status ?? "none"}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0"><div className="truncate text-sm font-medium">{l.name}</div>{o.lines.length > 1 && <Ref muted>{l.lineRef}</Ref>}</div>
                      {a ? <Badge variant={a.status === "approved" ? "success" : a.status === "changes_requested" ? "warning" : "outline"}>{ARTWORK[a.status]}{a.decidedAt && a.status !== "submitted" && <span className="font-mono normal-case tracking-normal"> · {formatDate(a.decidedAt)}</span>}</Badge> : <Badge variant="green">Your upload needed</Badge>}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-2">
                      {a?.dieline ? <a href={a.dieline.downloadUrl} className="link" download data-testid="dieline">Dieline · {a.dieline.filename}</a> : <span className="text-muted-foreground">Dieline coming</span>}
                      {a?.file && <a href={a.file.downloadUrl} className="link" download>Your file v{a.version} · {a.file.filename}</a>}
                    </div>
                    {a?.note && <p className="text-xs text-muted-foreground">Your note: “{a.note}”</p>}
                    {(due || (a && a.status !== "approved" && o.state === "awaiting_artwork")) && !preview && o.state === "awaiting_artwork" && (
                      <div><UploadArtworkSheet orderRef={o.ref} line={{ orderLineId: l.id, lineRef: l.lineRef, name: l.name }} variant={due ? "action" : "outline"} label={a ? "Upload new version" : "Upload artwork"} /></div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        {/* Quality check */}
        <Section id="qc" title="Quality check" action={o.inspection?.report ? <Button asChild variant="outline" size="sm"><a href={o.inspection.report.downloadUrl} download data-testid="view-qc-report"><Download />View QC report</a></Button> : undefined}>
          {!o.inspection ? <p className="text-sm text-muted-foreground">Inspection not scheduled yet.</p> : (
            <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-3" data-testid="qc">
              <Row label="Scheduled"><DateTime value={o.inspection.scheduledFor} /></Row>
              <Row label="Inspected"><DateTime value={o.inspection.inspectedAt} /></Row>
              <Row label="Result">{o.inspection.result ? <Badge variant={o.inspection.result === "pass" ? "success" : "warning"}>{o.inspection.result === "pass" ? "Passed" : "Rework in progress"}</Badge> : <span className="text-muted-foreground">pending</span>}</Row>
            </dl>
          )}
          {o.exception === "qc_failed" && <p className="mt-2 text-sm text-ink-2">Rework in progress — no action needed from you.</p>}
        </Section>

        {/* Shipping */}
        <Section id="shipping" title="Shipping">
          {!o.shipment || (!o.shipment.etd && !o.shipment.cargoReady && !o.shipment.containerOrAwb) ? (
            <p className="text-sm text-muted-foreground">Not shipped yet.{o.shipment?.etaPort && <> Planned ETA {o.shipment.portOfDischarge ?? "port"} <DateTime value={o.shipment.etaPort} className="font-medium text-foreground" />.</>}</p>
          ) : (
            <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-3" data-testid="shipping">
              <Row label="Mode">{o.shipment.mode ? MODE[o.shipment.mode] : "—"}</Row>
              {o.shipment.forwarderName && <Row label="Forwarder">{o.shipment.forwarderName}</Row>}
              <Row label="ETD"><DateTime value={o.shipment.etd} /></Row>
              <Row label={`ETA ${o.shipment.portOfDischarge ?? "port"}`}><DateTime value={o.shipment.etaPort} /></Row>
              <Row label="Tracking"><span className="font-mono">{o.shipment.containerOrAwb ?? "—"}</span></Row>
              <Row label="Customs">{CUSTOMS[o.shipment.customsStatus]}</Row>
              <Row label="Delivered"><DateTime value={o.shipment.deliveredAt ?? o.deliveredAt} /></Row>
            </dl>
          )}
          {(o.shipment?.billOfLading || o.shipment?.packingList) && (
            <ul className="sheet mt-3">
              {[o.shipment.billOfLading, o.shipment.packingList].filter((d): d is ClientDocumentDto => !!d).map((d) => <DocumentRow key={d.id} name={d.filename} kind={d.kind as never} bytes={d.bytes} at={d.uploadedAt} visibility="client" href={d.downloadUrl} />)}
            </ul>
          )}
        </Section>

        {/* Tabs */}
        <Tabs defaultValue="updates" className="rounded-xl border border-border bg-card p-5">
          <TabsList><TabsTrigger value="updates">Updates</TabsTrigger><TabsTrigger value="documents" data-testid="tab-documents">Documents <span className="font-mono text-xs text-muted-foreground">{o.documents.length}</span></TabsTrigger><TabsTrigger value="history">History</TabsTrigger></TabsList>
          <TabsContent value="updates" className="pt-4" id="updates"><Timeline entries={dto.updates.map(toEntry)} emptyText="No updates yet." /></TabsContent>
          <TabsContent value="documents" className="pt-4" id="documents">
            {o.documents.length === 0 ? <EmptyState title="No documents yet" body="Invoices, dielines, QC reports and shipping papers appear here." /> : (
              <ul className="sheet" data-testid="client-documents">
                {o.documents.map((d) => <DocumentRow key={d.id} name={d.filename} kind={d.kind as never} bytes={d.bytes} at={d.uploadedAt} visibility="client" href={d.downloadUrl} />)}
              </ul>
            )}
          </TabsContent>
          <TabsContent value="history" className="pt-4" id="history">
            {dto.previousOrders.length > 0 && (
              <div className="mb-5">
                <div className="mb-2 eyebrow">You ordered this product before</div>
                <ul className="sheet" data-testid="previous-orders">
                  {dto.previousOrders.map((p) => (
                    <li key={p.orderRef} className="sheet-row flex items-center gap-4 text-sm"><Link href={`/app/orders/${p.orderRef}`} className="link font-mono text-xs">{p.orderRef}</Link><Qty qty={p.qty} unit={p.unit} /><UnitPrice minorE2={p.unitPrice.minorE2} currency={p.unitPrice.currency} unit={p.unit} plusFee={!!p.fee} /><span className="ml-auto font-mono text-xs text-muted-foreground">{p.deliveredAt ? `delivered ${formatDate(p.deliveredAt)}` : ""}</span></li>
                  ))}
                </ul>
              </div>
            )}
            <Timeline entries={dto.history.map((e) => ({ id: e.id, kind: e.isActionMilestone ? "action_milestone" : e.isMilestone ? "milestone" : "system", at: e.at, title: e.text, author: e.actorName }))} emptyText="—" />
          </TabsContent>
        </Tabs>

        {(o.canConfirmDelivery || o.canReorder || o.hasFactoryRange) && (
          <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5 sm:flex-row sm:items-center sm:justify-between" data-testid="order-footer">
            <div className="text-sm text-ink-2">
              {o.canConfirmDelivery ? "Received everything? Confirm to close the order." : o.canReorder ? "Order it again in one click — same spec, your quantity." : ""}
              {o.hasFactoryRange && <Link href={`/app/orders/${o.ref}/range`} className="link ml-1 inline-flex items-center gap-1"><Factory className="size-3.5" />More from this factory</Link>}
            </div>
            <div className="flex flex-wrap gap-2">
              {o.canReorder && <ReorderSheet dto={dto} disabled={preview} />}
              {o.canConfirmDelivery && <ConfirmDeliveryButton orderRef={o.ref} disabled={preview} />}
            </div>
          </div>
        )}
        {dto.agentName && <p className="text-xs text-muted-foreground">Your contact at Influensia: {dto.agentName}</p>}
      </div>
    </div>
  );
}

function primaryAction(dto: ClientOrderPageDto, preview?: boolean): { label: string; href: string; node: React.ReactNode } | null {
  const o = dto.order;
  const pi = o.documents.find((d) => d.kind === "pi");
  switch (o.waitingReason) {
    case "deposit_due": return { label: "View invoice", href: pi?.downloadUrl ?? "#payments", node: <Button asChild variant="action" size="lg"><a href={pi?.downloadUrl ?? "#payments"} download={!!pi} data-testid="primary-action">View invoice</a></Button> };
    case "artwork_due": { const l = dto.artworkDue[0]; return l ? { label: "Upload artwork", href: "#artwork", node: <UploadArtworkSheet orderRef={o.ref} line={l} disabled={preview} /> } : { label: "Upload artwork", href: "#artwork", node: null }; }
    case "balance_due": return { label: "View QC report", href: o.inspection?.report?.downloadUrl ?? "#qc", node: <Button asChild variant="action" size="lg"><a href={o.inspection?.report?.downloadUrl ?? "#qc"} download={!!o.inspection?.report} data-testid="primary-action">View QC report</a></Button> };
    case "delivery_confirm": return { label: "Confirm delivery", href: "#order-footer", node: <ConfirmDeliveryButton orderRef={o.ref} disabled={preview} /> };
    case "needs_input": return { label: "Answer", href: "#updates", node: null };
    default: return null;
  }
}

const money = (pays: ClientOrderPageDto["order"]["payments"], kind: string) => { const p = pays.find((x) => x.kind === kind && x.status === "pending"); return p ? formatMoney(p.amount) : ""; };

function toEntry(u: ClientOrderPageDto["updates"][number]): TimelineEntry {
  return { id: u.id, kind: u.kind === "comment" ? "note" : u.isActionMilestone ? "action_milestone" : "milestone", at: u.at, title: u.kind === "event" ? u.text : undefined, body: u.kind === "comment" ? u.text : undefined, author: u.authorName ? (u.byYou ? `${u.authorName} (you)` : u.authorName) : undefined, attachments: u.attachments.map((a) => ({ id: a.id, name: a.filename, href: a.downloadUrl })) };
}

function Section({ id, title, action, children, className }: { id: string; title: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section id={id} className={cn("scroll-mt-20 rounded-xl border border-border bg-card p-5", className)} aria-labelledby={`${id}-h`} data-testid={`section-${id}`}>
      <div className="mb-3 flex items-center justify-between gap-3"><h2 id={`${id}-h`} className="text-lg font-semibold">{title}</h2>{action}</div>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><dt className="eyebrow">{label}</dt><dd className="mt-0.5 font-mono text-sm text-foreground">{children}</dd></div>;
}
