"use client";
import * as React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowRight, ExternalLink, Loader2 } from "lucide-react";
import type { ClientLinePageDto } from "@/server/client/dto/lines";
import type { ActionResult } from "@/server/shared/http";
import { formatMoney, formatUnitPrice, formatQty } from "@/server/shared/money";
import { formatDate } from "@/server/shared/dates";
import { PageHeader } from "@/components/shared/page-header";
import { MilestoneStepper } from "@/components/shared/milestone-stepper";
import { WaitingOnYouCard } from "@/components/shared/waiting-on-you-card";
import { FactsStrip } from "@/components/shared/facts-strip";
import { ExceptionChip, MilestoneChip, OfferStatusChip, SampleStatusChip, UtilityBadge } from "@/components/shared/chips";
import { Timeline, type TimelineEntry } from "@/components/shared/timeline";
import { DocumentRow } from "@/components/shared/document-row";
import { FactoryLabel } from "@/components/shared/factory-label";
import { EmptyState } from "@/components/shared/empty-state";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { C } from "./strings";

type AskFn = (input: { lineRef: string; body: string }) => Promise<ActionResult<{ lineRef: string; answered: boolean }>>;

/** SPEC F-07 / DESIGN §6.3 — client line page. Renders the DTO only; built at 390px first. */
export function ClientLinePage({ dto, initialTab, ask }: { dto: ClientLinePageDto; initialTab?: string; ask: AskFn }) {
  const tm = useTranslations("milestone");
  const tw = useTranslations("waiting");
  const l = dto.line;
  const waitingOnClient = !!l.waitingReason;
  const tab = ["updates", "documents", "history", "ask"].includes(initialTab ?? "") ? initialTab! : "updates";
  const updates: TimelineEntry[] = dto.timeline.updates.map((u) => ({ id: u.id, kind: u.kind === "comment" ? (u.byYou ? "question" : "note") : u.isActionMilestone ? "action_milestone" : "milestone", at: u.at, title: u.text, author: u.authorName ?? undefined, attachments: u.attachments.map((a) => ({ id: a.id, name: a.filename, href: a.downloadUrl })) }));
  const history: TimelineEntry[] = dto.timeline.history.map((e) => ({ id: e.id, kind: e.isActionMilestone ? "action_milestone" : e.isMilestone ? "milestone" : "system", at: e.at, title: e.text, author: e.actorName ?? undefined }));
  const waitingTitle = l.waitingReason === "offer_sent" ? tw("offer_sent", { name: l.name }) : l.waitingReason === "sample_received" ? tw("sample_received", { name: l.name }) : l.waitingReason === "needs_input" ? tw("needs_input", { name: l.name }) : l.waitingReason === "delivery_confirm" && l.orderRef ? tw("delivery_confirm", { ref: l.orderRef }) : l.waitingReason === "artwork_due" ? tw("artwork_due", { name: l.name }) : l.waitingReason ? tw(`button.${l.waitingReason}`) : "";
  const facts = [
    { label: C.line.quantity, value: l.qty ? formatQty(l.qty) : "—", sub: l.unit },
    { label: C.line.price, value: l.price ? formatUnitPrice({ minorE2: l.price.minorE2, currency: l.price.currency }) : "—", sub: l.price ? `/ ${l.price.unit}${l.fee ? ` ${C.line.plusFee}` : ""}` : C.line.priceTbc },
    { label: C.line.eta, value: l.etaDate ? formatDate(l.etaDate) : "—", sub: l.etaLabel ?? C.line.etaTbc },
    { label: C.line.yourRef, value: l.clientSku ?? "—", sub: l.requestRef },
  ];

  return (
    <div className="flex flex-col gap-6" data-testid="client-line" data-ref={l.ref} data-state={l.state}>
      <PageHeader
        eyebrow={<span className="font-mono">{l.ref} · {dto.companyLabel}</span>}
        title={l.name}
        titleSuffix={<span data-testid="milestone-suffix">{tm(l.milestone)} · {tm("stepOf", { step: l.milestoneStep })}</span>}
        meta={<><MilestoneChip milestone={l.milestone} waitingOnClient={waitingOnClient} showStep={l.milestoneStep} />{l.exception && <ExceptionChip exception={l.exception} client />}{l.factoryLabel && <FactoryLabel label={l.factoryLabel} />}{l.isRepeat && <UtilityBadge kind="repeat">Repeat</UtilityBadge>}{l.agentName && <span className="text-xs text-muted-foreground">{C.line.contact(l.agentName)}</span>}</>}
        actions={<>
          <Button asChild variant="outline" size="lg"><Link href={`/app/lines/${l.ref}?tab=ask#ask`}>{C.line.tabs.ask}</Link></Button>
          {dto.primaryAction && <Button asChild variant="action" size="lg" data-testid="primary-action"><Link href={dto.primaryAction.href.startsWith("#") ? `/app/lines/${l.ref}?tab=ask#ask` : dto.primaryAction.href}>{dto.primaryAction.label}</Link></Button>}
        </>}
      />
      <div className="rounded-xl border border-border bg-card p-5">
        <MilestoneStepper milestone={l.milestone} subLabel={l.subLabel} waitingOnClient={waitingOnClient} sampleSkipped={l.sampleSkipped} />
      </div>
      {l.waitingReason && dto.primaryAction && (
        <WaitingOnYouCard items={[{ id: l.waitingReason, title: waitingTitle, context: l.waitingReason === "needs_input" && dto.openQuestion ? `“${dto.openQuestion}”` : dto.waitingReasonDetail ? dto.waitingReasonDetail : undefined, due: dto.offer?.validUntil && l.waitingReason === "offer_sent" ? `due ${formatDate(dto.offer.validUntil, "d MMM")}` : undefined, action: { label: dto.primaryAction.label, href: dto.primaryAction.href.startsWith("#") ? `/app/lines/${l.ref}?tab=ask#ask` : dto.primaryAction.href } }]} />
      )}
      <FactsStrip facts={facts} />
      <p className="text-sm text-ink-2" data-testid="sub-label">{l.subLabel}</p>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="min-w-0">
          <Tabs defaultValue={tab} className="gap-4">
            <TabsList className="overflow-x-auto">
              <TabsTrigger value="updates" data-testid="tab-updates">{C.line.tabs.updates}</TabsTrigger>
              <TabsTrigger value="documents" data-testid="tab-documents">{C.line.tabs.documents} <span className="font-mono text-xs text-muted-foreground">{dto.documents.length}</span></TabsTrigger>
              <TabsTrigger value="history" data-testid="tab-history">{C.line.tabs.history}</TabsTrigger>
              <TabsTrigger value="ask" data-testid="tab-ask">{C.line.tabs.ask}</TabsTrigger>
            </TabsList>
            <TabsContent value="updates"><div className="rounded-xl border border-border bg-card p-5" data-testid="updates"><Timeline entries={updates} emptyText={C.line.updatesEmpty} /></div></TabsContent>
            <TabsContent value="documents">
              {dto.documents.length === 0 ? <div className="rounded-xl border border-border bg-card"><EmptyState title={C.line.documentsEmpty} /></div> : (
                <ul className="sheet" data-testid="documents">{dto.documents.map((d) => <DocumentRow key={d.id} name={d.filename} kind={d.kind as never} bytes={d.bytes} at={d.uploadedAt} visibility="client" href={d.downloadUrl} />)}</ul>
              )}
            </TabsContent>
            <TabsContent value="history"><div className="rounded-xl border border-border bg-card p-5" data-testid="history"><Timeline entries={history} emptyText={C.line.historyEmpty} /></div></TabsContent>
            <TabsContent value="ask"><AskForm lineRef={l.ref} ask={ask} openQuestion={dto.openQuestion} /></TabsContent>
          </Tabs>
        </div>

        <aside className="flex flex-col gap-4 lg:sticky lg:top-20 lg:self-start">
          {l.specSummary && (
            <section className="rounded-xl border border-border bg-card p-5" data-testid="spec-summary">
              <div className="eyebrow mb-1">{C.line.specTitle}{l.specVersion ? ` · v${l.specVersion}` : ""}</div>
              <p className="text-sm text-foreground">{l.specSummary}</p>
            </section>
          )}
          {!l.specSummary && (l.links.length > 0 || l.note) && (
            <section className="rounded-xl border border-border bg-card p-5">
              <div className="eyebrow mb-1">{C.line.weUnderstood}</div>
              {l.note && <p className="text-sm text-ink-2">{l.note}</p>}
              {l.links.map((u) => <a key={u} href={u} target="_blank" rel="noreferrer noopener" className="link mt-1 flex items-center gap-1 truncate text-xs">{u}<ExternalLink className="size-3 shrink-0" /></a>)}
            </section>
          )}
          {dto.offer && (
            <Link href={dto.offer.href} className="block rounded-xl border border-border bg-card p-5 transition-shadow hover:shadow-md" data-testid="offer-card">
              <div className="flex items-center justify-between"><span className="eyebrow">{C.line.offerCard} · v{dto.offer.version}</span><OfferStatusChip status={dto.offer.status} /></div>
              <div className="mt-2 font-mono text-xl font-medium">{dto.offer.unitPrice ? formatUnitPrice({ minorE2: dto.offer.unitPrice.minorE2, currency: dto.offer.unitPrice.currency }) : "—"}<span className="text-sm font-normal text-muted-foreground"> / {dto.offer.unitPrice?.unit ?? l.unit}</span>{dto.offer.fee && <span className="ml-1 text-sm text-ink-2">+ {formatMoney(dto.offer.fee)} {C.offer.fee}</span>}</div>
              <div className="mt-1 text-xs text-muted-foreground">{dto.offer.acceptedOptionLabel ? `${C.offer.accepted} ${dto.offer.acceptedOptionLabel} · ${formatDate(dto.offer.decidedAt)}` : dto.offer.validUntil ? C.line.validUntil(formatDate(dto.offer.validUntil)) : ""}</div>
              <div className="mt-2 flex items-center gap-1 text-sm text-foreground">{C.line.viewOffer}<ArrowRight className="size-4" /></div>
            </Link>
          )}
          {dto.sample && (
            <Link href={dto.sample.href} className="block rounded-xl border border-border bg-card p-5 transition-shadow hover:shadow-md" data-testid="sample-card">
              <div className="flex items-center justify-between"><span className="eyebrow">{C.line.sampleCard}</span><SampleStatusChip status={dto.sample.status} /></div>
              <div className="mt-2 text-sm text-ink-2">{dto.sample.courier ?? ""} <span className="font-mono">{dto.sample.tracking ?? ""}</span></div>
              <div className="mt-2 flex items-center gap-1 text-sm text-foreground">{C.line.viewSample}<ArrowRight className="size-4" /></div>
            </Link>
          )}
          {dto.order && (
            <Link href={dto.order.href} className="block rounded-xl border border-border bg-card p-5 transition-shadow hover:shadow-md" data-testid="order-card">
              <div className="flex items-center justify-between"><span className="eyebrow">{C.line.orderCard}</span><span className="font-mono text-xs">{dto.order.ref}</span></div>
              <div className="mt-2 text-sm text-ink-2">{tm(dto.order.milestone)}{dto.order.etaLabel ? ` · ${dto.order.etaLabel}` : ""}</div>
              <div className="mt-2 flex items-center gap-1 text-sm text-foreground">{C.line.viewOrder}<ArrowRight className="size-4" /></div>
            </Link>
          )}
          {dto.previousOrders.length > 0 && (
            <section className="rounded-xl border border-border bg-card p-5" data-testid="previous-orders">
              <div className="eyebrow mb-2">{C.line.previous}</div>
              <ul className="divide-y divide-hairline-faint">
                {dto.previousOrders.map((o) => (
                  <li key={o.orderRef} className="flex items-center justify-between py-2 text-sm">
                    <Link href={`/app/orders/${o.orderRef}`} className="link font-mono text-xs">{o.orderRef}</Link>
                    <span className="font-mono text-xs">{formatQty(o.qty, o.unit)} · {formatUnitPrice({ minorE2: o.unitPrice.minorE2, currency: o.unitPrice.currency })}{o.fee ? ` ${C.line.plusFee}` : ""}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {dto.factoryRange && (
            <Link href={dto.factoryRange.href} className="flex items-center justify-between rounded-xl border border-border bg-card p-5 text-sm hover:shadow-md" data-testid="factory-range-link">
              <span className="flex items-center gap-2">{C.line.moreFromFactory} <FactoryLabel label={dto.factoryRange.label} /></span><ArrowRight className="size-4" />
            </Link>
          )}
        </aside>
      </div>
    </div>
  );
}

export function AskForm({ lineRef, ask, openQuestion, compact }: { lineRef: string; ask: AskFn; openQuestion: string | null; compact?: boolean }) {
  const router = useRouter();
  const [body, setBody] = React.useState("");
  const [pending, start] = React.useTransition();
  const [done, setDone] = React.useState<string | null>(null);
  return (
    <form id="ask" className={cn("rounded-xl border border-border bg-card p-5", compact && "p-4")} data-testid="ask-form"
      onSubmit={(e) => { e.preventDefault(); if (!body.trim()) return; start(async () => { const r = await ask({ lineRef, body }); if (r.ok) { setDone(r.data.answered ? C.line.answered : C.line.sent); setBody(""); toast.success(r.data.answered ? C.line.answered : C.line.sent); router.refresh(); } else toast.error(r.error); }); }}>
      <h2 className="text-base font-semibold">{C.line.askTitle}</h2>
      <p className="mt-0.5 text-sm text-muted-foreground">{C.line.askHint}</p>
      {openQuestion && <div className="mt-3 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm"><span className="text-xs font-semibold text-green-700">{C.line.questionOpen}</span> {openQuestion}</div>}
      <Textarea className="mt-3 min-h-24 text-base" value={body} onChange={(e) => setBody(e.target.value)} placeholder={C.line.askPlaceholder} data-testid="ask-text" />
      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="text-xs text-success">{done}</span>
        <Button type="submit" size="lg" disabled={pending || !body.trim()} data-testid="ask-send">{pending && <Loader2 className="animate-spin" />}{C.line.send}</Button>
      </div>
    </form>
  );
}
