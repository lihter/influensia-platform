import Link from "next/link";
import { ProductThumb } from "@/components/shared/media";
import { ArrowRight, ExternalLink, Factory, MessageCircle } from "lucide-react";
import type { ClientLinePageDto } from "@/server/client/dto/lines";
import { formatMoney, formatUnitPrice, formatQty } from "@/server/shared/money";
import { milestoneIndex } from "@/server/shared/state-machine";
import { fmtDate, fmtDateShort } from "@/lib/format-date";
import { specKeyLabel, specValueLabel, unitLabel } from "@/lib/labels";
import { PageHeader } from "@/components/shared/page-header";
import { PageBand } from "@/components/shared/section-band";
import { MilestoneStepper } from "@/components/shared/milestone-stepper";
import { WaitingOnYouCard } from "@/components/shared/waiting-on-you-card";
import { FactsStrip, type Fact } from "@/components/shared/facts-strip";
import { ExceptionChip, MilestoneChip, UtilityBadge } from "@/components/shared/chips";
import { Timeline, type TimelineEntry } from "@/components/shared/timeline";
import { DocumentRow } from "@/components/shared/document-row";
import { FactoryLabel } from "@/components/shared/factory-label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { AskComposer } from "../ask-composer";
import { NowNextStrip } from "../now-next";
import { chipLabel, nextStepFor, stepperDates, platformOf, shortLink, perUnit, expectedText, trackingUrl } from "../client-format";
import { RequestChangeButton } from "./request-change";
import { C } from "./strings";

/** Waiting-card titles on the line page: the H1 already names the product, so the card says only what to do. */
const WAIT_TITLE: Record<string, string> = {
  offer_sent: "Your price is ready",
  sample_received: "Your sample has arrived — check it and approve",
  needs_input: "We need your answer",
  deposit_due: "Deposit due — your invoice is ready",
  artwork_due: "Upload your artwork",
  balance_due: "Quality check passed — balance due",
  delivery_confirm: "Confirm you received everything",
};

const WAIT_HINT: Record<string, string> = {
  sample_received: "Check it against what we confirmed, then approve it or tell us what's wrong.",
  deposit_due: "Production starts once the deposit is in.",
  artwork_due: "PDF, AI, PNG or JPG — we check it against the dieline.",
  balance_due: "The goods ship once the balance is in.",
  delivery_confirm: "Received everything? Confirming closes the order.",
};

/**
 * SPEC F-07 / DESIGN §6.3 — client line page, one status and one primary action (UX #2):
 * white band = header + dated stepper + (Waiting card | Now → Next strip) · page band = facts · alt band = what we
 * confirmed / your price / sample / order · page band = Updates (with the Ask composer at the bottom) / Documents / History.
 * Renders the client DTO only.
 */
export function ClientLinePage({ dto, initialTab }: { dto: ClientLinePageDto; initialTab?: string }) {
  const l = dto.line;
  const waitingOnClient = !!l.waitingReason;
  const hasDocs = dto.documents.length > 0;
  const tabs = ["updates", ...(hasDocs ? ["documents"] : []), "history"];
  const tab = tabs.includes(initialTab ?? "") ? initialTab! : "updates";
  const step = nextStepFor({
    milestone: l.milestone, state: l.state, waitingReason: l.waitingReason, exception: l.exception, offerOutcome: l.offerOutcome,
    sourcing: l.sourcingProgress, since: l.lastChangeAt, agentName: l.agentName, isRepeat: l.isRepeat, etaDate: l.etaDate, etaLabel: l.etaLabel,
    offerValidUntil: dto.offer?.status === "sent" ? dto.offer.validUntil : null, sampleStatus: dto.sample?.status ?? null, onHoldReason: l.onHoldReason,
  });
  const afterOrder = milestoneIndex(l.milestone) >= milestoneIndex("order_confirmed") || !!l.orderRef;
  const dates = stepperDates(l.milestoneDates, l.milestone, step, afterOrder ? l.etaDate : null);
  const primaryHref = dto.primaryAction ? (dto.primaryAction.href.startsWith("#") ? "#ask" : dto.primaryAction.href) : null;

  const updates: TimelineEntry[] = dto.timeline.updates.map((u) => ({
    id: u.id, kind: u.kind === "comment" ? "note" : u.isActionMilestone ? "action_milestone" : "milestone", at: u.at,
    title: u.kind === "comment" ? undefined : u.text, body: u.kind === "comment" ? u.text : undefined,
    author: u.kind === "comment" ? (u.byYou ? "You" : u.authorName ?? "Influensia") : u.authorName ?? undefined,
    attachments: u.attachments.map((a) => ({ id: a.id, name: a.filename, href: a.downloadUrl })),
  }));
  const history: TimelineEntry[] = dto.timeline.history.map((e) => ({ id: e.id, kind: e.isActionMilestone ? "action_milestone" : e.isMilestone ? "milestone" : "system", at: e.at, title: e.text, author: e.actorName ?? undefined }));

  const priceFact: Fact = l.price
    ? { label: C.line.price, value: formatUnitPrice({ minorE2: l.price.minorE2, currency: l.price.currency }), sub: `per ${perUnit(l.price.unit)}${l.fee ? ` + ${formatMoney(l.fee)} fee per order` : ""}` }
    : step.next === "Your price" || step.next === "New price"
      ? { label: step.next === "New price" ? "New price expected" : "Price expected", value: step.when ? expectedText(step.when) : "Soon", sub: step.next === "New price" ? "we're revising it now" : "usually 5 working days from the spec" }
      : { label: C.line.price, value: <span className="font-sans text-base">{l.milestone === "received" ? "After the spec" : "Being confirmed"}</span>, sub: l.milestone === "received" ? "about 5 working days later" : undefined };
  const facts: Fact[] = [
    { label: C.line.quantity, value: l.qty ? formatQty(l.qty) : "—", sub: l.qty ? unitLabel(l.unit, l.qty) : "to be confirmed" },
    priceFact,
    afterOrder
      ? { label: l.etaDate ? C.line.eta : "Delivery", value: l.etaDate ? fmtDate(l.etaDate) : <span className="font-sans text-base">Being scheduled</span>, sub: l.etaLabel ?? undefined }
      : { label: "Your contact", value: <span className="font-sans">{l.agentName ?? "Being assigned"}</span>, sub: l.agentName ? "replies within 1 working day" : "within 1 working day" },
    l.clientSku
      ? { label: C.line.yourRef, value: <span className="[overflow-wrap:anywhere]">{l.clientSku}</span>, sub: <Link href={`/app/requests/${l.requestRef}`} className="link font-mono">{l.requestRef}</Link> }
      : { label: "Request", value: <Link href={`/app/requests/${l.requestRef}`} className="text-base whitespace-nowrap hover:underline sm:text-xl">{l.requestRef}</Link>, sub: `line ${String(l.lineNo).padStart(2, "0")}` },
  ];

  const offer = dto.offer;
  const offerStatus = !offer ? null
    : offer.status === "accepted" ? `You accepted option ${offer.acceptedOptionLabel ?? "A"} on ${fmtDateShort(offer.decidedAt)}`
    : offer.status === "changes_requested" ? "You asked for changes — a new price is coming"
    : offer.status === "declined" ? "You declined this price"
    : offer.status === "expired" ? "This price expired — a new one is coming"
    : offer.validUntil ? `Waiting for your decision · valid until ${fmtDateShort(offer.validUntil)}` : "Waiting for your decision";

  const cards: React.ReactNode[] = [];
  cards.push(
    l.specFields.length > 0 || l.specSummary ? (
      <section key="spec" className="flex flex-col rounded-xl border border-border bg-card p-5" data-testid="spec-summary">
        <div className="eyebrow mb-2">{C.line.specTitle}{l.specVersion ? ` · v${l.specVersion}` : ""}</div>
        {l.specFields.length > 0 ? (
          <dl className="divide-y divide-hairline-faint text-sm" data-testid="spec-fields">
            {l.specFields.map((f) => (
              <div key={f.key} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-3 py-1.5 first:pt-0 last:pb-0">
                <dt className="text-xs leading-5 text-muted-foreground">{specKeyLabel(f.key)}</dt>
                <dd className="font-medium text-foreground [overflow-wrap:anywhere]">{specValueLabel(f.value)}</dd>
              </div>
            ))}
          </dl>
        ) : <p className="text-sm text-foreground [overflow-wrap:anywhere]">{l.specSummary}</p>}
        {l.exception === "change_requested" && <p className="mt-3 text-xs text-warning">You asked for a change — we&apos;re on it.</p>}
        {l.canRequestChange && <div className="mt-4"><RequestChangeButton lineRef={l.ref} /></div>}
      </section>
    ) : (
      <section key="understood" className="rounded-xl border border-border bg-card p-5" data-testid="we-understood">
        <div className="eyebrow mb-2">{C.line.weUnderstood}</div>
        {l.note && <p className="text-sm text-ink-2 [overflow-wrap:anywhere]">“{l.note}”</p>}
        {l.links.length > 0 && (
          <ul className="mt-2 flex flex-col gap-1.5">
            {l.links.map((u) => (
              <li key={u} className="flex min-w-0 items-center gap-2">
                <span className="inline-flex h-5 shrink-0 items-center rounded-sm bg-section-alt px-1.5 text-2xs font-semibold text-ink-2">{platformOf(u).label}</span>
                <a href={u} target="_blank" rel="noreferrer noopener" title={u} className="link min-w-0 truncate text-xs">{shortLink(u)}</a>
                <ExternalLink className="size-3 shrink-0 text-muted-foreground" aria-hidden />
              </li>
            ))}
          </ul>
        )}
        {!l.note && l.links.length === 0 && <p className="text-sm text-muted-foreground">Your photos and notes are with {l.agentName ?? "your contact"}.</p>}
        <p className="mt-3 text-xs text-muted-foreground">{l.agentName ?? "Your contact"} confirms the exact spec with you next.</p>
      </section>
    ),
  );
  if (offer) cards.push(
    <Link key="offer" href={offer.href} className="group flex flex-col rounded-xl border border-border bg-card p-5 transition-shadow hover:shadow-md" data-testid="offer-card">
      <span className="eyebrow">{C.line.offerCard} · v{offer.version}</span>
      <div className="mt-2 font-mono text-xl font-medium whitespace-nowrap">{offer.unitPrice ? formatUnitPrice({ minorE2: offer.unitPrice.minorE2, currency: offer.unitPrice.currency }) : "—"}<span className="text-sm font-normal text-muted-foreground"> / {perUnit(offer.unitPrice?.unit ?? l.unit)}</span></div>
      {offer.fee && <div className="font-mono text-xs text-ink-2">+ {formatMoney(offer.fee)} service fee per order</div>}
      <p className={offer.status === "sent" ? "mt-2 text-xs font-medium text-green-700" : "mt-2 text-xs text-muted-foreground"} data-testid="offer-status">{offerStatus}</p>
      <span className="flex items-center gap-1 pt-3 text-sm text-foreground">{C.line.viewOffer}<ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" /></span>
    </Link>,
  );
  if (dto.sample) {
    const s = dto.sample;
    const track = trackingUrl(s.courier, s.tracking);
    cards.push(
      <section key="sample" className="flex flex-col rounded-xl border border-border bg-card p-5" data-testid="sample-card">
        <span className="eyebrow">{C.line.sampleCard}</span>
        <p className="mt-2 text-sm font-medium text-foreground">{s.status === "ordered" ? "Being made" : s.status === "shipped" ? "On its way to you" : s.status === "received" ? `Arrived${s.receivedAt ? ` ${fmtDateShort(s.receivedAt)}` : ""} — your approval` : s.status === "approved" ? `Approved${s.decidedAt ? ` ${fmtDateShort(s.decidedAt)}` : ""}` : "Rejected — a new one is coming"}</p>
        {s.tracking && <p className="mt-1 text-xs text-ink-2">{s.courier} · {track ? <a href={track} target="_blank" rel="noreferrer noopener" className="link font-mono break-all">{s.tracking}</a> : <span className="font-mono break-all">{s.tracking}</span>}</p>}
        <Link href={s.href} className="flex items-center gap-1 pt-3 text-sm text-foreground hover:underline">{C.line.viewSample}<ArrowRight className="size-4" /></Link>
      </section>,
    );
  }
  if (dto.order) cards.push(
    <Link key="order" href={dto.order.href} className="group flex flex-col rounded-xl border border-border bg-card p-5 transition-shadow hover:shadow-md" data-testid="order-card">
      <div className="flex items-center justify-between gap-2"><span className="eyebrow">{C.line.orderCard}</span><span className="font-mono text-xs">{dto.order.ref}</span></div>
      <p className="mt-2 text-sm text-ink-2">{dto.order.etaLabel ?? "Payments, artwork, quality check and shipping"}</p>
      <span className="flex items-center gap-1 pt-3 text-sm text-foreground">{C.line.viewOrder}<ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" /></span>
    </Link>,
  );
  if (dto.previousOrders.length > 0) cards.push(
    <section key="prev" className="rounded-xl border border-border bg-card p-5" data-testid="previous-orders">
      <div className="eyebrow mb-2">{C.line.previous}</div>
      <ul className="divide-y divide-hairline-faint">
        {dto.previousOrders.map((o) => (
          <li key={o.orderRef} className="flex flex-wrap items-center justify-between gap-x-3 py-2 text-sm">
            <Link href={`/app/orders/${o.orderRef}`} className="link font-mono text-xs">{o.orderRef}</Link>
            <span className="font-mono text-xs">{formatQty(o.qty)} {unitLabel(o.unit, o.qty)} · {formatUnitPrice({ minorE2: o.unitPrice.minorE2, currency: o.unitPrice.currency })} / {perUnit(o.unit)}</span>
          </li>
        ))}
      </ul>
    </section>,
  );
  if (dto.factoryRange) cards.push(
    <Link key="range" href={dto.factoryRange.href} className="group flex flex-col gap-2 rounded-xl border border-border bg-card p-5 transition-shadow hover:shadow-md" data-testid="factory-range-link">
      <span className="eyebrow flex items-center gap-1.5"><Factory className="size-3" />{C.line.moreFromFactory}</span>
      <FactoryLabel label={dto.factoryRange.label} className="self-start whitespace-nowrap" />
      <span className="text-xs text-muted-foreground">Quick quotes from the factory making this — no new sourcing round.</span>
      <span className="flex items-center gap-1 pt-1 text-sm text-foreground">See the range<ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" /></span>
    </Link>,
  );

  return (
    <div data-testid="client-line" data-ref={l.ref} data-state={l.state}>
      <PageHeader
        band
        className="pb-6"
        crumbs={[{ href: "/app/requests", label: "Requests" }, { href: `/app/requests/${l.requestRef}`, label: <span className="font-mono">{l.requestRef}</span> }, { label: <span className="font-mono">{String(l.lineNo).padStart(2, "0")}</span> }]}
        title={l.name}
        media={<ProductThumb image={dto.image} name={l.name} domain={l.links[0] ? (() => { try { return new URL(l.links[0]).hostname.replace(/^www\./, ""); } catch { return null; } })() : null} size="xl" />}
        meta={<>
          <span data-testid="milestone-suffix">{l.exception ? <ExceptionChip exception={l.exception} client /> : <MilestoneChip milestone={l.milestone} waitingOnClient={waitingOnClient} label={chipLabel(l)} />}</span>
          {l.exception === "on_hold" && l.onHoldReason && <span className="text-xs text-ink-2">{l.onHoldReason}</span>}
          {l.isRepeat && <UtilityBadge kind="repeat">Repeat</UtilityBadge>}
          {l.agentName && <span className="text-xs text-muted-foreground">{C.line.contact(l.agentName)}</span>}
        </>}
        actions={<Button asChild variant="outline" size="lg"><a href="#ask"><MessageCircle data-icon="inline-start" />Ask a question</a></Button>}
        tabs={<div className="pt-3">
          <MilestoneStepper milestone={l.milestone} label={l.milestoneLabel} waitingOnClient={waitingOnClient} sampleSkipped={l.sampleSkipped} dates={dates} />
        <div className="mt-5">
          {l.waitingReason && dto.primaryAction && primaryHref ? (
            <WaitingOnYouCard items={[{
              id: l.waitingReason,
              title: WAIT_TITLE[l.waitingReason] ?? dto.primaryAction.label,
              context: l.waitingReason === "needs_input" && dto.openQuestion ? `“${dto.openQuestion}”` : l.waitingReason === "offer_sent" && offer ? `${offer.unitPrice ? `${formatUnitPrice({ minorE2: offer.unitPrice.minorE2, currency: offer.unitPrice.currency })} / ${perUnit(offer.unitPrice.unit)}` : "Your offer"}${offer.fee ? ` + ${formatMoney(offer.fee)} fee` : ""}` : WAIT_HINT[l.waitingReason] ?? l.subLabel,
              due: offer?.validUntil && l.waitingReason === "offer_sent" ? `valid until ${fmtDateShort(offer.validUntil)}` : undefined,
              action: { label: dto.primaryAction.label, href: primaryHref },
            }]} />
          ) : (
            <NowNextStrip step={step} detail={l.milestone === "finding_factory" || l.milestone === "shipping" ? l.subLabel : null} />
          )}
        </div>
        </div>}
      />
      <PageBand tone="page" pad="md">
        <FactsStrip facts={facts} />
      </PageBand>

      <PageBand tone="alt" pad="md" aria-label="Details">
        <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2 lg:grid-cols-3">{cards}</div>
      </PageBand>

      <PageBand tone="page" pad="lg">
        <Tabs defaultValue={tab} className="gap-4">
          <TabsList>
            <TabsTrigger value="updates" data-testid="tab-updates">{C.line.tabs.updates}</TabsTrigger>
            {hasDocs && <TabsTrigger value="documents" data-testid="tab-documents">{C.line.tabs.documents} <span className="font-mono text-xs text-muted-foreground">{dto.documents.length}</span></TabsTrigger>}
            <TabsTrigger value="history" data-testid="tab-history">{C.line.tabs.history}</TabsTrigger>
          </TabsList>
          <TabsContent value="updates" className="flex flex-col gap-4">
            <div className="rounded-xl border border-border bg-card p-5 [overflow-wrap:anywhere]" data-testid="updates"><Timeline entries={updates} limit={5} emptyText={C.line.updatesEmpty} /></div>
            <AskComposer target={{ kind: "line", ref: l.ref }} agentName={l.agentName} openQuestion={dto.openQuestion} />
          </TabsContent>
          {hasDocs && (
            <TabsContent value="documents">
              <ul className="sheet" data-testid="documents">{dto.documents.map((d) => <DocumentRow key={d.id} name={d.filename} kind={d.kind as never} bytes={d.bytes} at={d.uploadedAt} href={d.downloadUrl} />)}</ul>
            </TabsContent>
          )}
          <TabsContent value="history"><div className="rounded-xl border border-border bg-card p-5 [overflow-wrap:anywhere]" data-testid="history"><Timeline entries={history} limit={8} emptyText={C.line.historyEmpty} /></div></TabsContent>
        </Tabs>
      </PageBand>
    </div>
  );
}
