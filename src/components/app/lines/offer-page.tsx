"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Check, Clock } from "lucide-react";
import type { ClientOfferDto, ClientOfferOptionDto } from "@/server/client/dto";
import type { ActionResult } from "@/server/shared/http";
import { formatMoney, formatUnitPrice, formatQty } from "@/server/shared/money";
import { fmtDate, fmtDateShort } from "@/lib/format-date";
import { unitLabel } from "@/lib/labels";
import { PageHeader } from "@/components/shared/page-header";
import { PageBand } from "@/components/shared/section-band";
import { Eyebrow } from "@/components/shared/eyebrow";
import { UtilityBadge } from "@/components/shared/chips";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { perUnit } from "../client-format";
import { C } from "./strings";

type Label = "A" | "B" | "C";
type DeclineReason = "too_expensive" | "lead_time" | "spec" | "no_longer_needed" | "other";
type Actions = {
  accept: (i: { ref: string; optionLabel: Label }) => Promise<ActionResult<{ lineRef: string; sampleRequired: boolean }>>;
  changes: (i: { ref: string; text: string }) => Promise<ActionResult<{ lineRef: string }>>;
  decline: (i: { ref: string; reason: DeclineReason; text?: string | null }) => Promise<ActionResult<{ lineRef: string }>>;
};

const DAY = 86_400_000;
const daysLeft = (iso: string | null) => (iso ? Math.ceil((new Date(`${iso}T23:59:59Z`).getTime() - Date.now()) / DAY) : null);

/** One money model for the card, the decision block and the bar: goods = qty × unit price, + fee, = total. */
function money(o: ClientOfferOptionDto, qty: number | null) {
  const goods = qty && o.unitPriceMinorE2 !== null ? Math.round((qty * o.unitPriceMinorE2) / 100) : null;
  const fee = o.fee?.minor ?? 0;
  return { goods, fee, total: goods !== null ? goods + fee : null, currency: o.currency };
}

/** "none" / "-" entries mean "matches your reference" (UX #5). */
function deviationsOf(o: ClientOfferOptionDto): string[] {
  return (o.deviations ?? "").split(/\n|;|•/).map((s) => s.trim().replace(/^[-–]\s*/, "")).filter((s) => s && !/^(none|no|n\/a|-|—)$/i.test(s));
}

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex items-baseline justify-between gap-3 border-b border-hairline-faint py-2 last:border-b-0">
    <dt className="text-xs text-muted-foreground">{label}</dt>
    <dd className="min-w-0 text-right text-[13px] text-foreground [overflow-wrap:anywhere]">{children}</dd>
  </div>
);

function MoneyBlock({ o, qty, className }: { o: ClientOfferOptionDto; qty: number | null; className?: string }) {
  const m = money(o, qty);
  const cur = (minor: number) => formatMoney({ minor, currency: m.currency });
  return (
    <div className={className} data-testid="money-block">
      <div className="font-mono text-2xl font-medium leading-8 whitespace-nowrap text-foreground">{o.unitPriceMinorE2 !== null ? formatUnitPrice({ minorE2: o.unitPriceMinorE2, currency: o.currency }) : "—"}<span className="text-sm font-normal text-muted-foreground"> / {perUnit(o.unit)}</span></div>
      {m.goods !== null && qty && (
        <dl className="mt-3 font-mono text-[13px]">
          <div className="flex justify-between gap-3 py-1"><dt className="font-sans text-xs text-muted-foreground">Goods · {formatQty(qty)} × {formatUnitPrice({ minorE2: o.unitPriceMinorE2!, currency: o.currency })}</dt><dd>{cur(m.goods)}</dd></div>
          {m.fee > 0 && <div className="flex justify-between gap-3 py-1"><dt className="font-sans text-xs text-muted-foreground">Service fee · per order</dt><dd>{cur(m.fee)}</dd></div>}
          <div className="mt-1 flex justify-between gap-3 border-t border-rule-ink pt-2 font-medium text-foreground"><dt className="font-sans text-sm">Total</dt><dd data-testid="money-total">{cur(m.total!)}</dd></div>
        </dl>
      )}
    </div>
  );
}

function OptionCard({ o, offer, selected, onSelect, multi }: { o: ClientOfferOptionDto; offer: ClientOfferDto; selected: boolean; onSelect: () => void; multi: boolean }) {
  const accepted = offer.acceptedOptionLabel === o.label;
  const dimmed = offer.status === "accepted" && !accepted;
  const devs = deviationsOf(o);
  const qty = offer.qty;
  const m = money(o, qty);
  const selectable = offer.canDecide && multi;
  return (
    <div role={selectable ? "radio" : undefined} aria-checked={selectable ? selected : undefined} tabIndex={selectable ? 0 : undefined}
      onClick={selectable ? onSelect : undefined} onKeyDown={(e) => { if (selectable && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onSelect(); } }}
      className={cn("flex h-full flex-col rounded-2xl border border-border bg-card p-6 transition-shadow", selectable && "cursor-pointer hover:shadow-md", selectable && selected && "ring-2 ring-green-600", accepted && "border-green-200 bg-green-50", dimmed && "opacity-60")}
      data-testid="option-card" data-label={o.label} data-accepted={accepted || undefined}>
      <div className="flex items-center justify-between gap-2">
        <Eyebrow variant="pill">{C.offer.option} {o.label}</Eyebrow>
        {accepted ? <UtilityBadge kind="recommended" className="normal-case tracking-normal">{C.line.acceptedOn(fmtDate(offer.decidedAt))}</UtilityBadge> : o.recommended && offer.status === "sent" && multi ? <UtilityBadge kind="recommended" className="normal-case tracking-normal">{C.offer.recommended}</UtilityBadge> : null}
      </div>
      <div className="mt-3 font-mono text-2xl font-medium leading-8 whitespace-nowrap text-foreground" data-testid="option-price">{o.unitPriceMinorE2 !== null ? formatUnitPrice({ minorE2: o.unitPriceMinorE2, currency: o.currency }) : "—"}<span className="text-sm font-normal text-muted-foreground"> / {perUnit(o.unit)}</span></div>
      <p className="mt-1 text-xs text-muted-foreground">
        {qty ? <>for <span className="font-mono">{formatQty(qty)} {unitLabel(o.unit, qty)}</span></> : null}
        {o.fee && <> · + <span className="font-mono">{formatMoney(o.fee)}</span> service fee per order</>}
        {multi && m.total !== null && <> · <span className="font-mono text-foreground">{formatMoney({ minor: m.total, currency: m.currency })}</span> total</>}
      </p>
      <dl className="mt-4">
        <Row label={C.offer.moq}><span className="font-mono">{o.moq ? `${formatQty(o.moq)} ${unitLabel(o.unit, o.moq)}` : "No minimum"}</span></Row>
        <Row label={C.offer.lead}><span className="font-mono">{o.leadDays ? C.offer.days(o.leadDays) : "Confirmed with the order"}</span></Row>
        {o.paymentTerms && <Row label={C.offer.terms}>{o.paymentTerms}</Row>}
        {offer.incoterm && <Row label={C.offer.incoterm}><span className="font-mono">{offer.incoterm}{offer.port ? ` ${offer.port}` : ""}</span></Row>}
        <Row label={C.offer.sampleBefore}>{o.sampleRequired ? (o.sampleCost ? <><span className="font-mono">{formatMoney(o.sampleCost)}</span> · {C.offer.paidBy(o.samplePaidBy ?? "client")}</> : "Required — cost confirmed before it ships") : "Not needed"}</Row>
        {!o.sampleRequired && o.sampleCost && <Row label="Optional sample"><span className="font-mono">{formatMoney(o.sampleCost)}</span> · {C.offer.paidBy(o.samplePaidBy ?? "client")}</Row>}
      </dl>
      {o.priceBreaks.length > 1 && (
        <div className="mt-4">
          <div className="eyebrow mb-1">{C.offer.ladder}</div>
          <table className="w-full text-[13px]"><tbody>{o.priceBreaks.map((b) => <tr key={b.minQty} className={cn("border-b border-hairline-faint last:border-b-0", qty && b.minQty <= qty && "font-medium")}><td className="py-1 font-mono">{formatQty(b.minQty)}+</td><td className="py-1 text-right font-mono">{formatUnitPrice({ minorE2: b.unitPriceMinorE2, currency: o.currency })}</td></tr>)}</tbody></table>
        </div>
      )}
      <div className="mt-4" data-testid="deviations">
        {devs.length === 0 ? (
          <p className="flex items-center gap-1.5 text-sm text-foreground"><Check className="size-3.5 text-success" />Matches your reference</p>
        ) : (
          <>
            <div className="eyebrow mb-1">{C.offer.deviations}</div>
            <ul className="list-disc pl-4 text-sm text-ink-2">{devs.map((s, i) => <li key={i} className="[overflow-wrap:anywhere]">{s}</li>)}</ul>
          </>
        )}
      </div>
      {selectable && (
        <div className="mt-auto pt-5">
          <Button type="button" variant={selected ? "default" : "outline"} size="lg" className="w-full" onClick={(e) => { e.stopPropagation(); onSelect(); }} data-testid={`select-${o.label}`} aria-pressed={selected}>
            {selected ? <><Check />Option {o.label} selected</> : `Choose option ${o.label}`}
          </Button>
        </div>
      )}
    </div>
  );
}

const AFTER = [
  ["Deposit invoice", "We confirm the order and send the deposit invoice (usually 30 %)."],
  ["Sample, then production", "If a sample is needed you approve it first; production starts after the deposit."],
  ["Quality check before the balance", "An inspection checks every order before you pay the balance."],
] as const;

/** SPEC F-08 / UX #5 — options left, sticky decision + money block right; phone: option tabs + fixed decision bar. */
export function ClientOfferPage({ offer, versions, actions }: { offer: ClientOfferDto; versions: { ref: string; version: number; status: string }[]; actions: Actions }) {
  const router = useRouter();
  const multi = offer.options.length > 1;
  const initial = (offer.acceptedOptionLabel ?? offer.options.find((o) => o.recommended)?.label ?? offer.options[0]?.label ?? "A") as Label;
  const [selected, setSelected] = React.useState<Label>(initial);
  const [dialog, setDialog] = React.useState<"accept" | "changes" | "decline" | null>(null);
  const [text, setText] = React.useState("");
  const [reason, setReason] = React.useState<DeclineReason | null>(null);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [pending, start] = React.useTransition();
  const opt = offer.options.find((o) => o.label === selected) ?? offer.options[0];
  const left = daysLeft(offer.validUntil);
  const m = opt ? money(opt, offer.qty) : null;
  const status = offer.status === "accepted" ? C.offer.statusAccepted(offer.acceptedOptionLabel ?? "", fmtDate(offer.decidedAt))
    : offer.status === "changes_requested" ? C.offer.statusChanges
    : offer.status === "declined" ? C.offer.statusDeclined
    : offer.status === "expired" || (offer.status === "sent" && !offer.canDecide) ? C.offer.statusExpired : null;
  const done = (r: ActionResult<{ lineRef: string }>, msg: string) => {
    if (r.ok) { toast.success(msg); setDialog(null); router.push(`/app/lines/${r.data.lineRef}`); router.refresh(); }
    else { const e = r.message ?? (r.errors ? Object.values(r.errors)[0] : null) ?? "Couldn't send — please try again."; setFormError(e); toast.error(e); }
  };
  const open = (d: typeof dialog) => { setFormError(null); setDialog(d); };
  const summary = opt && m?.total != null && offer.qty ? <>Option {opt.label} · {formatQty(offer.qty)} {unitLabel(opt.unit, offer.qty)} · <span className="font-medium text-foreground">{formatMoney({ minor: m.total, currency: m.currency })}</span> total</> : opt ? <>Option {opt.label}</> : null;

  return (
    <div className="max-lg:pb-40" data-testid="client-offer" data-status={offer.status}>
      <PageHeader
        band
        crumbs={[{ href: "/app/requests", label: "Requests & orders" }, { href: `/app/lines/${offer.lineRef}`, label: <span className="font-mono">{offer.lineRef}</span> }, { label: `Offer v${offer.version}` }]}
        title={C.offer.title(offer.lineName)}
        meta={<>
          {offer.canDecide && offer.validUntil ? (
            <span className={cn("inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 font-mono text-xs", left !== null && left < 3 ? "border-danger-border bg-danger-wash text-danger" : left !== null && left < 7 ? "border-warning-border bg-warning-wash text-warning" : "border-neutral-border bg-neutral-wash text-ink-2")} data-testid="valid-until">
              <Clock className="size-3" />Valid until {fmtDateShort(offer.validUntil)}{left !== null && left >= 0 ? ` · ${left === 0 ? "last day" : `${left} ${left === 1 ? "day" : "days"} left`}` : ""}
            </span>
          ) : status ? <span className="text-sm text-ink-2" data-testid="offer-status-text">{status}</span> : null}
          <span className="font-mono text-xs text-muted-foreground">v{offer.version}{offer.incoterm ? ` · ${offer.incoterm}${offer.port ? ` ${offer.port}` : ""}` : ""}</span>
        </>}
      />

      <PageBand tone="page" pad="lg">
        {offer.noteFromUs && <p className="mb-6 rounded-xl border border-border bg-card p-4 text-sm text-ink-2 [overflow-wrap:anywhere]"><span className="eyebrow mr-2">Note from us</span>{offer.noteFromUs}</p>}
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="min-w-0">
            {multi && (
              <div className="mb-4 flex gap-1 rounded-lg bg-muted p-[3px] md:hidden" role="tablist" aria-label="Options">
                {offer.options.map((o) => <button key={o.label} type="button" role="tab" aria-selected={selected === o.label} onClick={() => setSelected(o.label)} className={cn("h-9 flex-1 rounded-md text-sm font-medium", selected === o.label ? "bg-card shadow-sm" : "text-ink-2")}>{C.offer.option} {o.label}</button>)}
              </div>
            )}
            <div className={cn("grid grid-cols-1 gap-4", offer.options.length === 2 && "md:grid-cols-2", offer.options.length >= 3 && "md:grid-cols-3")} role={multi && offer.canDecide ? "radiogroup" : undefined}>
              {offer.options.map((o) => (
                <div key={o.label} className={cn("min-w-0", multi && selected !== o.label && "max-md:hidden")}>
                  <OptionCard o={o} offer={offer} selected={selected === o.label} onSelect={() => setSelected(o.label)} multi={multi} />
                </div>
              ))}
            </div>
            {versions.length > 1 && <p className="mt-4 text-xs text-muted-foreground">{C.offer.versions}: {versions.map((v) => <Link key={v.ref} href={`/app/offers/${v.ref}`} className={cn("link mr-2 font-mono", v.ref === offer.ref && "font-semibold")}>v{v.version}</Link>)}</p>}
          </div>

          <aside className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-20 lg:self-start" aria-label="Your decision">
            {opt && (
              <div className="rounded-xl border border-border bg-card p-5" data-testid="decision-block">
                <div className="flex items-center justify-between gap-2">
                  <span className="eyebrow">{offer.status === "accepted" ? `Accepted · option ${opt.label}` : `Option ${opt.label}`}</span>
                  {offer.canDecide && offer.validUntil && <span className="font-mono text-2xs text-muted-foreground">until {fmtDateShort(offer.validUntil)}</span>}
                </div>
                <MoneyBlock o={opt} qty={offer.qty} className="mt-2 max-lg:hidden" />
                {!offer.canDecide && status && <p className="mt-3 text-sm text-ink-2 lg:hidden">{status}</p>}
                {offer.canDecide && (
                  <div className="max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:z-30 max-lg:border-t max-lg:border-border max-lg:bg-card/95 max-lg:px-4 max-lg:pt-3 max-lg:pb-[max(0.75rem,env(safe-area-inset-bottom))] max-lg:backdrop-blur-sm lg:mt-5" data-testid="decision-bar">
                    <p className="mb-2 text-center font-mono text-xs text-ink-2 lg:hidden" data-testid="decision-summary">{summary}</p>
                    <div className="grid grid-cols-2 gap-2">
                      <Button type="button" variant="action" size="lg" className="col-span-2 w-full" onClick={() => open("accept")} data-testid={`accept-${selected}`}>{C.offer.accept(selected)}</Button>
                      <Button type="button" variant="outline" size="lg" className="lg:col-span-2" onClick={() => open("changes")} data-testid="ask-changes">{C.offer.changes}</Button>
                      <Button type="button" variant="ghost" size="lg" className="text-danger hover:text-danger lg:col-span-2" onClick={() => open("decline")} data-testid="decline">{C.offer.decline}</Button>
                    </div>
                  </div>
                )}
              </div>
            )}
            <section className="rounded-xl border border-hairline-strong bg-section-alt p-5" aria-labelledby="after-h">
              <h2 id="after-h" className="text-sm font-semibold">{offer.status === "accepted" ? "What happens now" : "What happens when you accept"}</h2>
              <ol className="mt-3 flex flex-col gap-3">
                {AFTER.map(([t, b], i) => (
                  <li key={t}><Eyebrow variant="pill" number={i + 1}>{t}</Eyebrow><p className="mt-1 text-xs text-ink-2">{b}</p></li>
                ))}
              </ol>
            </section>
          </aside>
        </div>
      </PageBand>

      <Dialog open={dialog === "accept"} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{C.offer.acceptTitle}</DialogTitle><DialogDescription>{C.offer.acceptBody}</DialogDescription></DialogHeader>
          {opt && <div className="rounded-lg border border-border bg-card p-4"><span className="eyebrow">Option {opt.label}</span><MoneyBlock o={opt} qty={offer.qty} className="mt-1" />{opt.sampleRequired && <p className="mt-2 text-xs text-ink-2">A sample comes first — you approve it before production.</p>}</div>}
          {formError && <p className="text-xs text-danger" role="alert">{formError}</p>}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialog(null)}>{C.offer.cancel}</Button>
            <Button variant="action" disabled={pending} data-testid="accept-confirm" onClick={() => start(async () => done(await actions.accept({ ref: offer.ref, optionLabel: selected }), "Accepted — we'll confirm your order"))}>{pending && <Loader2 className="animate-spin" />}{C.offer.confirm}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={dialog === "changes"} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{C.offer.changes}</DialogTitle><DialogDescription>Tell us what to change — quantity, spec, lead time, packaging. We come back with a new price.</DialogDescription></DialogHeader>
          <Textarea rows={4} value={text} onChange={(e) => { setText(e.target.value); setFormError(null); }} className="text-base" placeholder="e.g. Can you quote 20,000 pairs with a shorter lead time?" data-testid="changes-text" aria-invalid={!!formError} />
          {formError && <p className="text-xs text-danger" role="alert">{formError}</p>}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialog(null)}>{C.offer.cancel}</Button>
            <Button disabled={pending} data-testid="changes-send" onClick={() => { if (text.trim().length < 10) { setFormError("Tell us a bit more (at least 10 characters)."); return; } start(async () => done(await actions.changes({ ref: offer.ref, text }), "Sent — a new price is on its way")); }}>{pending && <Loader2 className="animate-spin" />}{C.line.send}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={dialog === "decline"} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{C.offer.decline}</DialogTitle><DialogDescription>Why doesn&apos;t this work for you? It helps us come back with something better.</DialogDescription></DialogHeader>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={C.offer.declineReason} data-testid="decline-reason">
            {C.offer.declineReasons.map(([v, l]) => (
              <button key={v} type="button" role="radio" aria-checked={reason === v} onClick={() => { setReason(v); setFormError(null); }} data-value={v}
                className={cn("h-9 rounded-full border px-3 text-sm font-medium transition-colors", reason === v ? "border-foreground bg-foreground text-background" : "border-border bg-card text-ink-2 hover:bg-surface-sunken")}>{l}</button>
            ))}
          </div>
          <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder={C.offer.declineText} className="text-base" />
          {formError && <p className="text-xs text-danger" role="alert">{formError}</p>}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialog(null)}>{C.offer.cancel}</Button>
            <Button variant="destructive" disabled={pending} data-testid="decline-confirm" onClick={() => { if (!reason) { setFormError("Choose a reason first."); return; } start(async () => done(await actions.decline({ ref: offer.ref, reason, text: text || null }), "Declined — thanks for letting us know")); }}>{pending && <Loader2 className="animate-spin" />}{C.offer.decline}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
