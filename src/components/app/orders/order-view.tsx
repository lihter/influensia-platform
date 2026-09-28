import Link from "next/link";
import { Factory, Download, Check, MessageCircle, Triangle } from "lucide-react";
import type { ClientOrderPageDto } from "@/server/client/dto/orders";
import type { ClientDocumentDto } from "@/server/client/dto";
import { formatMoney, formatUnitPrice, formatQty } from "@/server/shared/money";
import { fmtDate, fmtDateShort } from "@/lib/format-date";
import { label, unitLabel } from "@/lib/labels";
import { PageHeader } from "@/components/shared/page-header";
import { PageBand } from "@/components/shared/section-band";
import { MilestoneStepper } from "@/components/shared/milestone-stepper";
import { WaitingOnYouCard, type WaitingItem } from "@/components/shared/waiting-on-you-card";
import { FactsStrip } from "@/components/shared/facts-strip";
import { ExceptionChip, MilestoneChip } from "@/components/shared/chips";
import { Timeline, type TimelineEntry } from "@/components/shared/timeline";
import { DocumentRow } from "@/components/shared/document-row";
import { Ref } from "@/components/shared/formatters";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { UploadArtworkSheet, ConfirmDeliveryButton, ReorderSheet } from "./order-actions";
import { AskComposer } from "../ask-composer";
import { NowNextStrip } from "../now-next";
import { nextStepFor, stepperDates, perUnit, clientInitials } from "../client-format";
import { cn } from "@/lib/utils";

const ARTWORK: Record<string, string> = { submitted: "Under review", changes_requested: "Changes requested", approved: "Approved" };
const PAY_ORDER = { deposit: 0, fee: 1, sample: 2, balance: 3 } as const;

/**
 * DESIGN §6.3 / UX #1 #2 #6 #10 — client order page. White band: header + stepper + (Waiting card | Now → Next);
 * page band: facts + numbered sections 01 Money · 02 Artwork · 03 Quality check · 04 Shipping; alt band: Updates with the
 * Ask composer, contact, close-out. Receives ONLY the client DTO; `preview` (ops "Viewing as client") disables actions.
 */
export function ClientOrderView({ dto, preview }: { dto: ClientOrderPageDto; preview?: boolean }) {
  const o = dto.order;
  const waitingOnClient = !!o.waitingReason;
  const payments = [...o.payments].sort((a, b) => PAY_ORDER[a.kind] - PAY_ORDER[b.kind]);
  const nextPayment = payments.find((p) => p.status === "pending");
  const pi = o.documents.find((d) => d.kind === "pi") ?? null;
  const invoice = o.documents.find((d) => d.kind === "invoice") ?? null;
  const firstLine = o.lines[0];
  const fee = o.lines.reduce((s, l) => s + (l.fee?.minor ?? 0), 0);
  const eta = o.shipment?.etaPort ?? o.exworksEta ?? null;
  const delivered = !!o.deliveredAt;
  const step = nextStepFor({ milestone: o.milestone, state: o.state, waitingReason: o.waitingReason, exception: o.exception, since: o.lastChangeAt, etaDate: eta, etaLabel: o.etaLabel, readyDate: o.exworksEta, agentName: dto.agentName });
  const dates = stepperDates(o.confirmedAt ? [{ milestone: "order_confirmed", at: o.confirmedAt }, ...(o.deliveredAt ? [{ milestone: "delivered" as const, at: o.deliveredAt }] : [])] : [], o.milestone, step, delivered ? null : o.shipment?.etaPort ?? null);

  const waitHref = o.waitingReason === "deposit_due" ? (pi?.downloadUrl ?? "#payments") : o.waitingReason === "artwork_due" ? "#artwork" : o.waitingReason === "balance_due" ? (o.inspection?.report?.downloadUrl ?? "#qc") : o.waitingReason === "delivery_confirm" ? "#close" : "#ask";
  const waitLabel = o.waitingReason === "deposit_due" ? (pi ? "Download invoice" : "See payments") : o.waitingReason === "artwork_due" ? "Upload artwork" : o.waitingReason === "balance_due" ? (o.inspection?.report ? "View QC report" : "See payments") : o.waitingReason === "delivery_confirm" ? "Confirm delivery" : "Answer";
  const waiting: WaitingItem[] = o.waitingReason ? [{
    id: o.waitingReason,
    title: o.waitingReason === "deposit_due" ? `Deposit ${money(payments, "deposit")}${money(payments, "fee") ? ` + fee ${money(payments, "fee")}` : ""} due` : o.waitingReason === "balance_due" ? `Quality check passed — balance ${money(payments, "balance")} due` : o.waitingReason === "artwork_due" ? (o.artworks.some((a) => a.status === "changes_requested") ? "Artwork changes requested" : "Upload your artwork") : o.waitingReason === "delivery_confirm" ? "Confirm you received everything" : "We need your answer",
    context: o.waitingReason === "balance_due" && o.inspection?.inspectedAt ? `Passed on ${fmtDate(o.inspection.inspectedAt)}${o.inspection.report ? " · report attached" : ""}` : o.waitingReason === "deposit_due" ? (o.piNumber && pi ? `Invoice ${o.piNumber}` : "Your invoice is being prepared — it will appear here") : o.waitingReason === "artwork_due" ? "PDF, AI, PNG or JPG — we check it against the dieline" : o.waitingReason === "delivery_confirm" && o.deliveredAt ? `Delivered ${fmtDate(o.deliveredAt)} — confirming closes the order` : undefined,
    due: nextPayment?.dueOn && (o.waitingReason === "deposit_due" || o.waitingReason === "balance_due") ? `due ${fmtDateShort(nextPayment.dueOn)}` : undefined,
    action: { label: waitLabel, href: waitHref },
  }] : [];

  const updates: TimelineEntry[] = dto.updates.map((u) => ({
    id: u.id, kind: u.kind === "comment" ? "note" : u.isActionMilestone ? "action_milestone" : "milestone", at: u.at,
    title: u.kind === "event" ? u.text : undefined, body: u.kind === "comment" ? u.text : undefined,
    author: u.kind === "comment" ? (u.byYou ? "You" : u.authorName ?? "Influensia") : u.authorName ?? undefined,
    attachments: u.attachments.map((a) => ({ id: a.id, name: a.filename, href: a.downloadUrl })),
  }));
  const history: TimelineEntry[] = dto.history.map((e) => ({ id: e.id, kind: e.isActionMilestone ? "action_milestone" : e.isMilestone ? "milestone" : "system", at: e.at, title: e.text, author: e.actorName }));
  const artworkLines = o.lines.filter((l) => l.artworkRequired || o.artworks.some((a) => a.lineRef === l.lineRef));
  const shipped = !!o.shipment && !!(o.shipment.etd || o.shipment.cargoReady || o.shipment.containerOrAwb);

  return (
    <div data-testid="client-order" data-ref={o.ref}>
      <PageHeader
        band
        className="pb-6"
        crumbs={[{ href: "/app/requests", label: "Requests & orders" }, { href: `/app/requests/${o.requestRef}`, label: <span className="font-mono">{o.requestRef}</span> }, { label: <span className="font-mono">{o.ref}</span> }]}
        title={o.name}
        meta={<>
          <span data-testid="milestone-suffix">{o.exception ? <ExceptionChip exception={o.exception} client /> : <MilestoneChip milestone={o.milestone} waitingOnClient={waitingOnClient} />}</span>
          {o.lines.length > 1 && <span className="text-xs text-muted-foreground">{o.lines.length} lines</span>}
          {dto.agentName && <span className="text-xs text-muted-foreground">Your contact: {dto.agentName}</span>}
        </>}
        actions={preview ? undefined : <Button asChild variant="outline" size="lg"><a href="#ask"><MessageCircle data-icon="inline-start" />Ask a question</a></Button>}
        tabs={<div className="pt-3" data-testid="stepper-card">
          <MilestoneStepper milestone={o.milestone} waitingOnClient={waitingOnClient} sampleSkipped={o.sampleSkipped} dates={dates} />
          <div className="mt-5">{o.waitingReason === "delivery_confirm" && o.canConfirmDelivery ? (
            <section className="flex flex-col gap-3 rounded-xl border border-green-200 bg-green-50 p-5 sm:flex-row sm:items-center sm:justify-between" data-testid="waiting-card" aria-label="Waiting on you">
              <div className="min-w-0">
                <span className="inline-flex h-[22px] items-center gap-1.5 rounded-full border border-green-200 bg-green-100 px-2.5 text-2xs font-semibold uppercase tracking-[0.08em] text-green-700"><Triangle className="size-2.5 fill-current" />Waiting on you</span>
                <h2 className="mt-3 text-lg font-semibold leading-7">{waiting[0]?.title}</h2>
                {waiting[0]?.context && <p className="mt-0.5 text-sm text-ink-2">{waiting[0].context}</p>}
              </div>
              <div className="shrink-0 max-sm:[&>*]:w-full"><ConfirmDeliveryButton orderRef={o.ref} disabled={preview} /></div>
            </section>
          ) : waiting.length > 0 ? <WaitingOnYouCard items={waiting} /> : <NowNextStrip step={step} detail={o.milestone === "shipping" ? o.subLabel : null} />}</div>
        </div>}
      />

      <PageBand tone="page" pad="md">
        <FactsStrip facts={[
          { label: "Quantity", value: firstLine ? formatQty(firstLine.qty) : "—", sub: firstLine ? `${unitLabel(firstLine.unit, firstLine.qty)}${o.lines.length > 1 ? ` · ${o.lines.length} lines` : firstLine.specVersion ? ` · spec v${firstLine.specVersion}` : ""}` : undefined },
          { label: "Price", value: firstLine ? formatUnitPrice({ minorE2: firstLine.unitPrice.minorE2, currency: firstLine.unitPrice.currency }) : "—", sub: `${firstLine ? `per ${perUnit(firstLine.unit)}` : ""}${fee ? ` + ${formatMoney({ minor: fee, currency: o.total.currency })} fee` : ""} · total ${formatMoney(o.total)}` },
          { label: delivered ? "Delivered" : o.shipment?.etaPort ? `ETA ${o.shipment.portOfDischarge ?? "port"}` : o.exworksEta ? "Ready ex-works" : "Delivery", value: delivered ? fmtDate(o.deliveredAt) : eta ? fmtDate(eta) : <span className="font-sans text-base">Being scheduled</span>, sub: o.incoterm ? `${o.incoterm}${o.port ? ` ${o.port}` : ""}` : undefined },
          nextPayment
            ? { label: "Next payment", value: formatMoney(nextPayment.amount), sub: `${label("paymentKind", nextPayment.kind)}${nextPayment.dueOn ? ` · due ${fmtDateShort(nextPayment.dueOn)}` : nextPayment.dueLabel ? ` · ${nextPayment.dueLabel}` : ""}` }
            : { label: "Payments", value: <span className="inline-flex items-center gap-1.5 font-sans text-base text-success"><Check className="size-4" />Paid in full</span> },
        ]} />
      </PageBand>

      <PageBand tone="page" pad="none" className="pb-8">
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
          {o.lines.length > 1 && (
            <Section id="lines" number={0} title="Lines" className="lg:col-span-2">
              <ul className="divide-y divide-hairline-faint">
                {o.lines.map((l) => (
                  <li key={l.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5 text-sm first:pt-0 last:pb-0">
                    <div className="min-w-0 flex-1"><div className="truncate font-medium" title={l.name}>{l.name}</div><Ref muted>{l.lineRef}</Ref></div>
                    <span className="font-mono text-[13px] text-ink-2">{formatQty(l.qty)} {unitLabel(l.unit, l.qty)}</span>
                    <span className="font-mono text-[13px]">{formatUnitPrice({ minorE2: l.unitPrice.minorE2, currency: l.unitPrice.currency })} / {perUnit(l.unit)}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Section id="payments" number={1} title="Money" action={pi ? <Button asChild variant="outline" size="sm"><a href={pi.downloadUrl} download data-testid="view-invoice"><Download />Invoice</a></Button> : undefined}>
            <ul className="divide-y divide-hairline-faint" data-testid="payments-table">
              {payments.map((p) => (
                <li key={p.id} className="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0" data-testid="payment-row" data-kind={p.kind} data-status={p.status}>
                  <div className="min-w-0">
                    <p className="text-sm font-medium whitespace-nowrap">{label("paymentKind", p.kind)}{p.pct !== null && <span className="ml-1 font-mono text-xs font-normal text-muted-foreground">{p.pct} %</span>}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                      <span className={cn("inline-flex h-5 items-center rounded-full border px-2 text-2xs font-medium", p.status === "paid" ? "border-success-border bg-success-wash text-success" : p.status === "waived" ? "border-neutral-border bg-neutral-wash text-ink-2" : "border-warning-border bg-warning-wash text-warning")}>{p.status === "paid" ? "Paid" : p.status === "waived" ? "Waived" : "Due"}</span>
                      <span className="font-mono whitespace-nowrap">{p.status === "paid" ? fmtDateShort(p.paidAt) : p.dueOn ? fmtDateShort(p.dueOn) : p.dueLabel ?? (p.kind === "deposit" || p.kind === "fee" ? "with the invoice" : "")}</span>
                    </p>
                  </div>
                  <span className="shrink-0 font-mono text-sm font-medium whitespace-nowrap text-foreground">{formatMoney(p.amount)}</span>
                </li>
              ))}
              <li className="flex items-baseline justify-between gap-3 border-t border-rule-ink pt-2.5 text-sm font-medium"><span>Order total</span><span className="font-mono">{formatMoney(o.total)}</span></li>
            </ul>
            {invoice && <p className="mt-3 text-xs text-muted-foreground">Balance invoice: <a href={invoice.downloadUrl} className="link break-all" download>{invoice.filename}</a></p>}
          </Section>

          <Section id="artwork" number={2} title="Artwork">
            {artworkLines.length === 0 ? (
              <p className="text-sm text-muted-foreground">No artwork needed for this order.</p>
            ) : (
              <ul className="divide-y divide-hairline-faint">
                {artworkLines.map((l) => {
                  const a = o.artworks.find((x) => x.lineRef === l.lineRef) ?? null;
                  const dieline = a?.dieline ?? o.documents.find((d) => d.kind === "dieline") ?? null;
                  const due = dto.artworkDue.find((x) => x.orderLineId === l.id);
                  return (
                    <li key={l.id} className="flex flex-col gap-2 py-2.5 first:pt-0 last:pb-0" data-testid="artwork-row" data-status={a?.status ?? "none"}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0"><div className="truncate text-sm font-medium">{l.name}</div>{o.lines.length > 1 && <Ref muted>{l.lineRef}</Ref>}</div>
                        {a ? <Badge variant={a.status === "approved" ? "success" : a.status === "changes_requested" ? "warning" : "outline"} className="normal-case tracking-normal">{ARTWORK[a.status]}{a.decidedAt && a.status !== "submitted" && <span className="font-mono"> · {fmtDateShort(a.decidedAt)}</span>}</Badge> : <Badge variant="green" className="normal-case tracking-normal">Your upload needed</Badge>}
                      </div>
                      <div className="flex flex-col gap-1 text-sm text-ink-2">
                        {dieline ? <a href={dieline.downloadUrl} className="link break-all" download data-testid="dieline">Template (dieline) · {dieline.filename}</a> : <span className="text-muted-foreground">The packaging template (dieline) appears here when it&apos;s ready.</span>}
                        {a?.file && <a href={a.file.downloadUrl} className="link break-all" download>Your file v{a.version} · {a.file.filename}</a>}
                      </div>
                      {a?.note && <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">Your note: “{a.note}”</p>}
                      {(due || (a && a.status !== "approved")) && !preview && o.state === "awaiting_artwork" && (
                        <div><UploadArtworkSheet orderRef={o.ref} line={{ orderLineId: l.id, lineRef: l.lineRef, name: l.name }} variant={due ? "action" : "outline"} label={a ? "Upload new version" : "Upload artwork"} /></div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>

          <Section id="qc" number={3} title="Quality check" action={o.inspection?.report ? <Button asChild variant="outline" size="sm"><a href={o.inspection.report.downloadUrl} download data-testid="view-qc-report"><Download />QC report</a></Button> : undefined}>
            {!o.inspection ? <p className="text-sm text-muted-foreground">We book an independent inspection before you pay the balance.</p> : (
              <dl className="grid grid-cols-3 gap-3 text-sm" data-testid="qc">
                <Cell label="Booked for">{o.inspection.scheduledFor ? fmtDateShort(o.inspection.scheduledFor) : "Being booked"}</Cell>
                <Cell label="Inspected">{o.inspection.inspectedAt ? fmtDateShort(o.inspection.inspectedAt) : "Not yet"}</Cell>
                <Cell label="Result" sans>{o.inspection.result ? <Badge variant={o.inspection.result === "pass" ? "success" : "warning"} className="normal-case tracking-normal">{o.inspection.result === "pass" ? "Passed" : "Rework in progress"}</Badge> : <span className="text-muted-foreground">After inspection</span>}</Cell>
              </dl>
            )}
            {o.exception === "qc_failed" && <p className="mt-2 text-sm text-ink-2">Rework in progress — no action needed from you.</p>}
          </Section>

          <Section id="shipping" number={4} title="Shipping">
            {!shipped ? (
              <p className="text-sm text-muted-foreground">Not shipped yet.{o.shipment?.etaPort && <> Planned arrival in {o.shipment.portOfDischarge ?? "port"} <span className="font-mono font-medium text-foreground">{fmtDate(o.shipment.etaPort)}</span>.</>}</p>
            ) : (
              <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3" data-testid="shipping">
                <Cell label="Mode" sans>{o.shipment!.mode ? label("shipmentMode", o.shipment!.mode) : "—"}</Cell>
                <Cell label="Departs">{o.shipment!.etd ? fmtDateShort(o.shipment!.etd) : "Being booked"}</Cell>
                <Cell label={delivered ? "Delivered" : `Arrives ${o.shipment!.portOfDischarge ?? "port"}`}>{delivered ? fmtDateShort(o.shipment!.deliveredAt ?? o.deliveredAt) : o.shipment!.etaPort ? fmtDateShort(o.shipment!.etaPort) : "—"}</Cell>
                {o.shipment!.forwarderName && <Cell label="Forwarder" sans><span className="[overflow-wrap:anywhere]">{o.shipment!.forwarderName.replace(/\s*\(client\)\s*$/i, "")} · arranged by you</span></Cell>}
                {o.shipment!.containerOrAwb && <Cell label="Container / AWB" className="col-span-2 sm:col-span-1"><span className="break-all">{o.shipment!.containerOrAwb}</span></Cell>}
                {!(delivered && o.shipment!.customsStatus !== "held") && <Cell label="Customs" sans>{label("customsStatus", o.shipment!.customsStatus)}</Cell>}
              </dl>
            )}
            {(o.shipment?.billOfLading || o.shipment?.packingList) && (
              <ul className="sheet mt-3">
                {[o.shipment.billOfLading, o.shipment.packingList].filter((d): d is ClientDocumentDto => !!d).map((d) => <DocumentRow key={d.id} name={d.filename} kind={d.kind as never} bytes={d.bytes} at={d.uploadedAt} href={d.downloadUrl} />)}
              </ul>
            )}
          </Section>
        </div>
      </PageBand>

      <PageBand tone="alt" pad="lg">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <Tabs defaultValue="updates" className="min-w-0 gap-4">
            <TabsList>
              <TabsTrigger value="updates">Updates</TabsTrigger>
              {o.documents.length > 0 && <TabsTrigger value="documents" data-testid="tab-documents">Documents <span className="font-mono text-xs text-muted-foreground">{o.documents.length}</span></TabsTrigger>}
              <TabsTrigger value="history">History</TabsTrigger>
            </TabsList>
            <TabsContent value="updates" className="flex flex-col gap-4" id="updates">
              <div className="rounded-xl border border-border bg-card p-5 [overflow-wrap:anywhere]"><Timeline entries={updates} limit={5} emptyText="No updates yet — you'll see every step here." /></div>
              <AskComposer target={{ kind: "order", ref: o.ref }} agentName={dto.agentName} disabled={preview} />
            </TabsContent>
            {o.documents.length > 0 && (
              <TabsContent value="documents" id="documents">
                <ul className="sheet" data-testid="client-documents">
                  {o.documents.map((d) => <DocumentRow key={d.id} name={d.filename} kind={d.kind as never} bytes={d.bytes} at={d.uploadedAt} href={d.downloadUrl} />)}
                </ul>
              </TabsContent>
            )}
            <TabsContent value="history" id="history">
              <div className="rounded-xl border border-border bg-card p-5 [overflow-wrap:anywhere]"><Timeline entries={history} limit={8} emptyText="Nothing yet." /></div>
            </TabsContent>
          </Tabs>

          <aside className="flex flex-col gap-4">
            {dto.agentName && (
              <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-4" data-testid="contact-card">
                <Avatar className="size-10"><AvatarFallback className="bg-section-alt text-xs font-semibold text-ink-2">{clientInitials(dto.agentName)}</AvatarFallback></Avatar>
                <div className="min-w-0"><p className="text-sm font-medium">{dto.agentName}</p><p className="text-xs text-muted-foreground">Your contact · replies within 1 working day</p></div>
              </div>
            )}
            {((o.canConfirmDelivery && o.waitingReason !== "delivery_confirm") || o.canReorder) && (
              <div id="close" className="scroll-mt-24 rounded-xl border border-border bg-card p-5" data-testid="order-footer">
                <p className="text-sm text-ink-2">{o.canConfirmDelivery && o.waitingReason !== "delivery_confirm" ? "Received everything? Confirm to close the order." : "Order it again — same spec, your quantity."}</p>
                <div className="mt-3 flex flex-wrap gap-2 [&>*]:flex-1">
                  {o.canConfirmDelivery && o.waitingReason !== "delivery_confirm" && <ConfirmDeliveryButton orderRef={o.ref} disabled={preview} />}
                  {o.canReorder && <ReorderSheet dto={dto} disabled={preview} />}
                </div>
              </div>
            )}
            {o.hasFactoryRange && (
              <Link href={`/app/orders/${o.ref}/range`} className="flex items-center gap-2 rounded-xl border border-border bg-card p-4 text-sm transition-shadow hover:shadow-md"><Factory className="size-4 text-muted-foreground" />More from this factory</Link>
            )}
            {dto.previousOrders.length > 0 && (
              <div className="rounded-xl border border-border bg-card p-4" data-testid="previous-orders">
                <p className="eyebrow mb-2">You ordered this before</p>
                <ul className="divide-y divide-hairline-faint">
                  {dto.previousOrders.map((p) => (
                    <li key={p.orderRef} className="flex flex-wrap items-center justify-between gap-x-3 py-1.5 text-xs"><Link href={`/app/orders/${p.orderRef}`} className="link font-mono">{p.orderRef}</Link><span className="font-mono text-ink-2">{formatQty(p.qty)} · {formatUnitPrice({ minorE2: p.unitPrice.minorE2, currency: p.unitPrice.currency })}</span></li>
                  ))}
                </ul>
              </div>
            )}
          </aside>
        </div>
      </PageBand>
    </div>
  );
}

const money = (pays: ClientOrderPageDto["order"]["payments"], kind: string) => { const p = pays.find((x) => x.kind === kind && x.status === "pending"); return p ? formatMoney(p.amount) : ""; };

function Section({ id, number, title, action, children, className }: { id: string; number: number; title: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section id={id} className={cn("scroll-mt-24 rounded-xl border border-border bg-card p-5", className)} aria-labelledby={`${id}-h`} data-testid={`section-${id}`}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          {number > 0 && <span className="inline-flex h-[22px] shrink-0 items-center rounded-full border border-green-200 bg-green-50 px-2.5 font-mono text-2xs font-medium text-green-700">{String(number).padStart(2, "0")}</span>}
          <h2 id={`${id}-h`} className="truncate text-base font-semibold">{title}</h2>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function Cell({ label: l, children, sans, className }: { label: string; children: React.ReactNode; sans?: boolean; className?: string }) {
  return <div className={cn("min-w-0", className)}><dt className="eyebrow">{l}</dt><dd className={cn("mt-1 text-sm text-foreground", !sans && "font-mono")}>{children}</dd></div>;
}
