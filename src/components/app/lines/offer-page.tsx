"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, ArrowLeft } from "lucide-react";
import type { ClientOfferDto, ClientOfferOptionDto } from "@/server/client/dto";
import type { ActionResult } from "@/server/shared/http";
import { formatMoney, formatUnitPrice, formatQty } from "@/server/shared/money";
import { formatDate, daysBetween } from "@/server/shared/dates";
import { PageHeader } from "@/components/shared/page-header";
import { Eyebrow } from "@/components/shared/eyebrow";
import { OfferStatusChip, UtilityBadge } from "@/components/shared/chips";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { C } from "./strings";

type Actions = {
  accept: (i: { ref: string; optionLabel: "A" | "B" | "C" }) => Promise<ActionResult<{ lineRef: string; sampleRequired: boolean }>>;
  changes: (i: { ref: string; text: string }) => Promise<ActionResult<{ lineRef: string }>>;
  decline: (i: { ref: string; reason: "too_expensive" | "lead_time" | "spec" | "no_longer_needed" | "other"; text?: string | null }) => Promise<ActionResult<{ lineRef: string }>>;
};

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex items-baseline justify-between gap-3 border-b border-hairline-faint py-2.5 last:border-b-0"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="text-right font-mono text-[13px] text-foreground">{children}</dd></div>
);

function OptionCard({ o, offer, selected, onSelect, dimmed }: { o: ClientOfferOptionDto; offer: ClientOfferDto; selected: boolean; onSelect: () => void; dimmed: boolean }) {
  const accepted = offer.acceptedOptionLabel === o.label;
  return (
    <div role={offer.canDecide ? "radio" : undefined} aria-checked={offer.canDecide ? selected : undefined} tabIndex={offer.canDecide ? 0 : -1}
      onClick={offer.canDecide ? onSelect : undefined} onKeyDown={(e) => { if (offer.canDecide && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onSelect(); } }}
      className={cn("rounded-2xl border border-border bg-card p-6 transition-shadow", offer.canDecide && "cursor-pointer hover:shadow-md", selected && "ring-2 ring-green-600", accepted && "border-green-200 bg-green-50", dimmed && "opacity-60")} data-testid="option-card" data-label={o.label} data-accepted={accepted || undefined}>
      <div className="flex items-center justify-between gap-2">
        <Eyebrow variant="pill">{C.offer.option} {o.label}</Eyebrow>
        {accepted ? <UtilityBadge kind="recommended">{C.line.acceptedOn(formatDate(offer.decidedAt))}</UtilityBadge> : o.recommended && offer.status === "sent" ? <UtilityBadge kind="recommended">{C.offer.recommended}</UtilityBadge> : null}
      </div>
      <div className="mt-3 font-mono text-2xl font-medium leading-8 text-foreground" data-testid="option-price">{o.unitPriceMinorE2 !== null ? formatUnitPrice({ minorE2: o.unitPriceMinorE2, currency: o.currency }) : "—"}<span className="text-sm font-normal text-muted-foreground"> / {o.unit}</span></div>
      {o.fee && <div className="font-mono text-[13px] text-ink-2">+ {formatMoney(o.fee)} {C.offer.fee} {C.offer.perOrder}</div>}
      {offer.qty && o.unitPriceMinorE2 !== null && <div className="mt-1 text-xs text-muted-foreground">{C.offer.at(formatQty(offer.qty, o.unit))} · {formatMoney({ minor: Math.round((offer.qty * o.unitPriceMinorE2) / 100) + (o.fee?.minor ?? 0), currency: o.currency })}</div>}
      <dl className="mt-4">
        <Row label={C.offer.moq}>{o.moq ? formatQty(o.moq, o.unit) : "—"}</Row>
        <Row label={C.offer.lead}>{o.leadDays ? C.offer.days(o.leadDays) : "—"}</Row>
        <Row label={C.offer.terms}><span className="font-sans">{o.paymentTerms ?? "—"}</span></Row>
        <Row label={C.offer.sample}>{o.sampleCost ? `${formatMoney(o.sampleCost)} · ${C.offer.paidBy(o.samplePaidBy ?? "client")}` : "—"}</Row>
        <Row label={C.offer.sampleBefore}>{o.sampleRequired ? C.offer.yes : C.offer.no}</Row>
        <Row label={C.offer.incoterm}>{offer.incoterm ?? "—"} {offer.port ?? ""}</Row>
      </dl>
      {o.priceBreaks.length > 1 && (
        <div className="mt-4">
          <div className="eyebrow mb-1">{C.offer.ladder}</div>
          <table className="w-full text-[13px]"><tbody>{o.priceBreaks.map((b) => <tr key={b.minQty} className="border-b border-hairline-faint last:border-b-0"><td className="py-1 font-mono">{formatQty(b.minQty)}</td><td className="py-1 text-right font-mono">{formatUnitPrice({ minorE2: b.unitPriceMinorE2, currency: o.currency })}</td></tr>)}</tbody></table>
        </div>
      )}
      <div className="mt-4">
        <div className="eyebrow mb-1">{C.offer.deviations}</div>
        <ul className="list-disc pl-4 text-sm text-ink-2">{(o.deviations ?? C.offer.none).split(/\n|;/).filter((s) => s.trim()).map((s, i) => <li key={i}>{s.trim()}</li>)}</ul>
      </div>
      {offer.canDecide && <Button type="button" variant={selected ? "action" : "outline"} size="lg" className="mt-5 w-full" onClick={(e) => { e.stopPropagation(); onSelect(); }} data-testid={`accept-${o.label}`}>{C.offer.accept(o.label)}</Button>}
    </div>
  );
}

/** SPEC F-08 / DESIGN §6.4 — options side by side (tabs at 390px), sticky decision bar. */
export function ClientOfferPage({ offer, versions, actions }: { offer: ClientOfferDto; versions: { ref: string; version: number; status: string }[]; actions: Actions }) {
  const router = useRouter();
  const [selected, setSelected] = React.useState<"A" | "B" | "C">(offer.options.find((o) => o.recommended)?.label ?? offer.options[0]?.label ?? "A");
  const [phoneTab, setPhoneTab] = React.useState<"A" | "B" | "C">(selected);
  const [dialog, setDialog] = React.useState<"accept" | "changes" | "decline" | null>(null);
  const [text, setText] = React.useState("");
  const [reason, setReason] = React.useState<(typeof C.offer.declineReasons)[number][0]>("too_expensive");
  const [pending, start] = React.useTransition();
  const opt = offer.options.find((o) => o.label === selected) ?? offer.options[0];
  const daysLeft = offer.validUntil ? daysBetween(new Date(), offer.validUntil) : null;
  const total = opt && offer.qty && opt.unitPriceMinorE2 !== null ? formatMoney({ minor: Math.round((offer.qty * opt.unitPriceMinorE2) / 100), currency: opt.currency }) : null;
  const done = (r: ActionResult<{ lineRef: string }>, msg: string) => { if (r.ok) { toast.success(msg); setDialog(null); router.push(`/app/lines/${r.data.lineRef}`); router.refresh(); } else toast.error(r.error === "E_VALIDATION" ? C.offer.changesHint : r.error); };
  const status = offer.status === "accepted" ? C.offer.statusAccepted(offer.acceptedOptionLabel ?? "", formatDate(offer.decidedAt)) : offer.status === "changes_requested" ? C.offer.statusChanges : offer.status === "declined" ? C.offer.statusDeclined : offer.status === "expired" || (offer.status === "sent" && !offer.canDecide) ? C.offer.statusExpired : null;

  return (
    <div className="flex flex-col gap-6 pb-24" data-testid="client-offer" data-status={offer.status}>
      <PageHeader
        eyebrow={<span className="font-mono">{C.offer.eyebrow(offer.lineRef).toUpperCase()}{offer.validUntil && <> · <span className={cn(daysLeft !== null && daysLeft < 7 && "text-warning", daysLeft !== null && daysLeft < 3 && "text-danger")} data-testid="valid-until">{C.offer.validUntil(formatDate(offer.validUntil)).toUpperCase()}</span></>}</span>}
        title={C.offer.title(offer.lineName)}
        titleSuffix={`v${offer.version}${offer.incoterm ? ` · ${offer.incoterm} ${offer.port ?? ""}` : ""}`}
        meta={<><OfferStatusChip status={offer.status} />{status && <span className="text-sm text-ink-2" data-testid="offer-status-text">{status}</span>}</>}
        actions={<Button asChild variant="ghost"><Link href={`/app/lines/${offer.lineRef}`}><ArrowLeft data-icon="inline-start" />{C.offer.backToLine}</Link></Button>}
      />
      {offer.noteFromUs && <p className="rounded-xl border border-border bg-card p-4 text-sm text-ink-2">{offer.noteFromUs}</p>}
      {offer.options.length > 1 && (
        <div className="flex gap-1 rounded-lg bg-muted p-[3px] md:hidden" role="tablist">
          {offer.options.map((o) => <button key={o.label} type="button" role="tab" aria-selected={phoneTab === o.label} onClick={() => setPhoneTab(o.label)} className={cn("h-8 flex-1 rounded-md text-sm font-medium", phoneTab === o.label ? "bg-card shadow-sm" : "text-ink-2")}>{C.offer.option} {o.label}</button>)}
        </div>
      )}
      <div className={cn("grid gap-4", offer.options.length === 2 && "md:grid-cols-2", offer.options.length >= 3 && "md:grid-cols-3")} role={offer.canDecide ? "radiogroup" : undefined}>
        {offer.options.map((o) => (
          <div key={o.label} className={cn(offer.options.length > 1 && phoneTab !== o.label && "max-md:hidden")}>
            <OptionCard o={o} offer={offer} selected={offer.canDecide && selected === o.label} onSelect={() => { setSelected(o.label); setPhoneTab(o.label); setDialog("accept"); }} dimmed={offer.status === "accepted" && offer.acceptedOptionLabel !== o.label} />
          </div>
        ))}
      </div>
      {versions.length > 1 && <p className="text-xs text-muted-foreground">{C.offer.versions}: {versions.map((v) => <Link key={v.ref} href={`/app/offers/${v.ref}`} className={cn("link mr-2 font-mono", v.ref === offer.ref && "font-semibold")}>v{v.version}</Link>)}</p>}

      {offer.canDecide && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card/95 p-4 backdrop-blur-sm" data-testid="decision-bar">
          <div className="mx-auto flex max-w-[72rem] flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span className="font-mono text-sm text-ink-2">{opt && total ? C.offer.summary(opt.label, offer.qty ? formatQty(offer.qty, opt.unit) : "", `${total}${opt.fee ? ` + ${formatMoney(opt.fee)} ${C.offer.fee}` : ""}`) : ""}</span>
            <div className="flex flex-wrap gap-2 max-sm:[&>*]:flex-1">
              <Button type="button" variant="ghost" size="lg" className="text-danger" onClick={() => setDialog("decline")} data-testid="decline">{C.offer.decline}</Button>
              <Button type="button" variant="outline" size="lg" onClick={() => setDialog("changes")} data-testid="ask-changes">{C.offer.changes}</Button>
              <Button type="button" variant="action" size="lg" onClick={() => setDialog("accept")} data-testid="accept">{C.offer.accept(selected)}</Button>
            </div>
          </div>
        </div>
      )}

      <Dialog open={dialog === "accept"} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{C.offer.acceptTitle}</DialogTitle><DialogDescription>{C.offer.acceptBody}</DialogDescription></DialogHeader>
          {opt && <p className="font-mono text-sm">{C.offer.option} {opt.label} · {opt.unitPriceMinorE2 !== null ? formatUnitPrice({ minorE2: opt.unitPriceMinorE2, currency: opt.currency }) : ""} / {opt.unit}{opt.fee ? ` + ${formatMoney(opt.fee)} ${C.offer.fee}` : ""}{opt.sampleRequired ? ` · ${C.offer.sampleBefore}` : ""}</p>}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialog(null)}>{C.offer.cancel}</Button>
            <Button variant="action" disabled={pending} data-testid="accept-confirm" onClick={() => start(async () => done(await actions.accept({ ref: offer.ref, optionLabel: selected }), "Accepted"))}>{pending && <Loader2 className="animate-spin" />}{C.offer.confirm}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={dialog === "changes"} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{C.offer.changes}</DialogTitle><DialogDescription>{C.offer.changesHint}</DialogDescription></DialogHeader>
          <Textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} className="text-base" data-testid="changes-text" />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialog(null)}>{C.offer.cancel}</Button>
            <Button disabled={pending || text.trim().length < 10} data-testid="changes-send" onClick={() => start(async () => done(await actions.changes({ ref: offer.ref, text }), "Sent"))}>{C.line.send}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={dialog === "decline"} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{C.offer.decline}</DialogTitle><DialogDescription>{C.offer.declineReason}</DialogDescription></DialogHeader>
          <select value={reason} onChange={(e) => setReason(e.target.value as never)} className="h-10 rounded-lg border border-input bg-card px-3 text-sm" data-testid="decline-reason">{C.offer.declineReasons.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder={C.offer.declineText} className="text-base" />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialog(null)}>{C.offer.cancel}</Button>
            <Button variant="destructive" disabled={pending} data-testid="decline-confirm" onClick={() => start(async () => done(await actions.decline({ ref: offer.ref, reason, text: text || null }), "Declined"))}>{C.offer.decline}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
