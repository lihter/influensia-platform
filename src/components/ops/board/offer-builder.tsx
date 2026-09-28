"use client";
import * as React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Lock, Trash2, Eye } from "lucide-react";
import type { OpsLine, OpsParticipation } from "@/server/ops/participations";
import type { SamplePaidBy } from "@/db/enums";
import { INCOTERMS, SAMPLE_PAID_BY } from "@/db/enums";
import { formatUnitPrice, formatMoney, formatQty } from "@/server/shared/money";
import { formatDate } from "@/server/shared/dates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { OfferStatusChip, UtilityBadge, VisibilityBadge } from "@/components/shared/chips";
import { Eyebrow } from "@/components/shared/eyebrow";
import { cn } from "@/lib/utils";
import { saveOfferAction } from "@/app/(ops)/ops/lines/[ref]/actions";
import { S } from "./strings";
import { useAction } from "./use-action";
import { prefillClientPriceE2, prefillFeeMinor, ladderPriceAt, parsePriceE2, parseAmountMinor, e2ToText, minorToText } from "./pure";

type Row = { qty: string; price: string };
type Opt = { participationId: string; moq: string; lead: string; rows: Row[]; fee: string; factoryE2: number | null; deviations: string; sampleCost: string; samplePaidBy: SamplePaidBy | ""; sampleRequired: boolean; terms: string; internalNote: string };
const LABELS = ["A", "B", "C"] as const;
const DEFAULT_TERMS = "30 % deposit + fee on order, 70 % after QC pass";
const validDefault = () => { const d = new Date(); d.setDate(d.getDate() + 14); return d.toISOString().slice(0, 10); };

function fromQuote(p: OpsParticipation, line: OpsLine): Opt {
  const q = p.latestQuote;
  const usd = p.usdMinorE2 ?? q?.normalisedUsdMinorE2 ?? null;
  const price = usd !== null ? prefillClientPriceE2(usd, line.pricingRule.marginPct, line.pricingRule.rounding) : null;
  const qty = line.qty ?? q?.moq ?? 1;
  const fee = line.org.pricingDisplay === "factory_plus_fee" && price ? prefillFeeMinor(price, qty, line.pricingRule.feePct) : 0;
  const moq = q?.moq && q.unit !== line.unit && q.packQty ? q.moq * q.packQty : q?.moq ?? null;
  return { participationId: p.id, moq: moq ? String(moq) : "", lead: q?.leadDays ? String(q.leadDaysMax ?? q.leadDays) : "", rows: [{ qty: String(qty), price: price !== null ? e2ToText(price) : "" }], fee: minorToText(fee), factoryE2: usd, deviations: q?.deviations && /^none/i.test(q.deviations) ? "none" : "", sampleCost: "", samplePaidBy: "client", sampleRequired: line.sampleRequired, terms: DEFAULT_TERMS, internalNote: "" };
}

const Field = ({ label, children, className, error }: { label: React.ReactNode; children: React.ReactNode; className?: string; error?: string }) => (
  <div className={cn("flex flex-col gap-1.5", className)}><Label>{label}</Label>{children}{error && <p className="text-xs text-danger">{error}</p>}</div>
);

/** SPEC F-18 — source quotes → options A/B/C, ladder editor, fee (pricing display aware), preview as client, send with leak check. */
export function OfferBuilder({ line, preselect, isAdmin }: { line: OpsLine; preselect: string[]; isAdmin: boolean }) {
  const { run, pending, errors } = useAction();
  const to = useTranslations("offer_status");
  const draft = line.offers.find((o) => o.status === "draft") ?? null;
  const quoted = line.participations.filter((p) => p.latestQuote);
  const initial = (): Opt[] => {
    if (draft) return draft.options.map((o) => ({ participationId: o.participationId ?? "", moq: o.moq ? String(o.moq) : "", lead: o.leadDays ? String(o.leadDays) : "", rows: o.priceBreaks.map((b) => ({ qty: String(b.min_qty), price: e2ToText(b.unit_price_minor_e2) })), fee: minorToText(o.feeMinor), factoryE2: o.factoryPriceMinorE2, deviations: o.deviationsPlain ?? "", sampleCost: o.sampleCostMinor ? minorToText(o.sampleCostMinor) : "", samplePaidBy: o.samplePaidBy ?? "", sampleRequired: o.sampleRequired, terms: o.paymentTermsClient ?? DEFAULT_TERMS, internalNote: o.internalNote ?? "" }));
    const pre = quoted.filter((p) => preselect.includes(p.id) || (!preselect.length && (p.status === "selected" || p.status === "shortlisted" || p.status === "negotiating"))).slice(0, 3);
    return pre.map((p) => fromQuote(p, line));
  };
  const [opts, setOpts] = React.useState<Opt[]>(initial);
  const [incoterm, setIncoterm] = React.useState(draft?.incoterm ?? "FOB");
  const [port, setPort] = React.useState(draft?.port ?? quoted.find((p) => preselect.includes(p.id))?.latestQuote?.port ?? quoted[0]?.latestQuote?.port ?? "");
  const [valid, setValid] = React.useState(draft?.validUntil ?? validDefault());
  const [note, setNote] = React.useState(draft?.noteToClient ?? "");
  const [preview, setPreview] = React.useState(false);
  const plusFee = line.org.pricingDisplay === "factory_plus_fee";
  const checked = new Set(opts.map((o) => o.participationId));
  const toggle = (p: OpsParticipation) => setOpts((os) => (checked.has(p.id) ? os.filter((o) => o.participationId !== p.id) : os.length >= 3 ? os : [...os, fromQuote(p, line)]));
  const setOpt = (i: number, patch: Partial<Opt>) => setOpts((os) => os.map((o, j) => (j === i ? { ...o, ...patch } : o)));
  const payload = () => ({
    lineId: line.id, offerId: draft?.id ?? null, incoterm: incoterm as never, port: port || null, validUntil: valid, noteToClient: note || null,
    options: opts.map((o, i) => ({ label: LABELS[i], participationId: o.participationId, moq: o.moq ? Number(o.moq) : null, leadDays: o.lead ? Number(o.lead) : null, priceBreaks: o.rows.map((r) => ({ min_qty: Number(r.qty), unit_price_minor_e2: parsePriceE2(r.price) ?? 0 })), feeMinor: plusFee ? parseAmountMinor(o.fee) ?? 0 : 0, factoryPriceMinorE2: o.factoryE2, deviationsPlain: o.deviations, sampleCostMinor: o.sampleCost ? parseAmountMinor(o.sampleCost) : null, samplePaidBy: o.samplePaidBy || null, sampleRequired: o.sampleRequired, paymentTermsClient: o.terms || null, internalNote: o.internalNote || null })),
  });
  const sent = line.offers.filter((o) => o.status !== "draft");
  const accepted = sent.find((o) => o.status === "accepted");
  const refPrice = line.product?.referencePriceMinorE2;
  const canSend = ["quotes_in", "shortlisted", "negotiating", "offer_ready"].includes(line.state) && !sent.some((o) => o.status === "sent");

  return (
    <div className="flex flex-col gap-6" data-testid="offer-builder">
      {refPrice && <p className="text-xs text-muted-foreground">{S.offer.reference(formatUnitPrice({ minorE2: refPrice, currency: "USD" }), line.product?.referenceMoq ? formatQty(line.product.referenceMoq) : "—")}</p>}
      <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
        {/* sources */}
        <section className="rounded-xl border border-border bg-card p-5 lg:self-start">
          <h2 className="text-base font-semibold">{S.offer.sources}</h2>
          <p className="mb-3 text-xs text-muted-foreground">{S.offer.sourcesHint}</p>
          {quoted.length === 0 ? <p className="text-sm text-muted-foreground">{S.offer.noQuotes}</p> : (
            <ul className="sheet" data-testid="offer-sources">
              {quoted.map((p) => (
                <li key={p.id}>
                  <label className={cn("sheet-row flex cursor-pointer items-start gap-3 text-sm hover:bg-surface-sunken", checked.has(p.id) && "bg-green-50")}>
                    <input type="checkbox" className="mt-1 accent-green-600" checked={checked.has(p.id)} disabled={!checked.has(p.id) && opts.length >= 3} onChange={() => toggle(p)} data-testid="source-check" data-supplier={p.supplier.ref} />
                    <div className="min-w-0">
                      <div className="truncate font-medium">{p.supplier.legalName}</div>
                      <div className="font-mono text-xs text-muted-foreground">{p.usdMinorE2 !== null ? `${formatUnitPrice({ minorE2: p.usdMinorE2, currency: "USD" }, { decimals: 4 })}/${line.unit}` : "—"} · {p.status}{p.flags.length ? ` · ${p.flags.length} flag${p.flags.length > 1 ? "s" : ""}` : ""}</div>
                    </div>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* options */}
        <section className="flex flex-col gap-4">
          {opts.length === 0 && <div className="rounded-xl border border-dashed border-hairline-strong p-8 text-center text-sm text-muted-foreground">{S.offer.noSelection}</div>}
          <div className={cn("grid gap-4", opts.length > 1 && "lg:grid-cols-2", opts.length > 2 && "xl:grid-cols-3")}>
            {opts.map((o, i) => {
              const p = line.participations.find((x) => x.id === o.participationId);
              const k = `option${LABELS[i]}`;
              const at = ladderPriceAt(o.rows.map((r) => ({ min_qty: Number(r.qty) || 0, unit_price_minor_e2: parsePriceE2(r.price) ?? 0 })), line.qty);
              return (
                <div key={o.participationId} className="rounded-2xl border border-border bg-card p-5" data-testid="option-card" data-label={LABELS[i]}>
                  <div className="mb-3 flex items-center justify-between">
                    <Eyebrow variant="pill">{S.offer.option} {LABELS[i]}</Eyebrow>
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" title={S.offer.lockIcon}><Lock className="size-3" />{p?.supplier.legalName ?? "—"}</span>
                  </div>
                  <div className="mb-3 font-mono text-2xl font-medium">{at ? formatUnitPrice({ minorE2: at, currency: "USD" }) : "—"}<span className="text-sm font-normal text-muted-foreground"> / {line.unit}</span>{plusFee && o.fee && <span className="ml-2 text-sm text-ink-2">+ {formatMoney({ minor: parseAmountMinor(o.fee) ?? 0, currency: "USD" })} fee</span>}</div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label={S.offer.moq}><Input value={o.moq} onChange={(e) => setOpt(i, { moq: e.target.value })} inputMode="numeric" className="text-right font-mono" /></Field>
                    <Field label={S.offer.lead}><Input value={o.lead} onChange={(e) => setOpt(i, { lead: e.target.value })} inputMode="numeric" className="text-right font-mono" /></Field>
                  </div>
                  <div className="mt-3">
                    <div className="mb-1.5 flex items-center justify-between"><Label>{S.offer.ladder} <span className="font-normal text-muted-foreground">· {S.offer.margin(line.pricingRule.marginPct)}</span></Label><Button size="xs" variant="ghost" type="button" onClick={() => setOpt(i, { rows: [...o.rows, { qty: "", price: "" }] })}>{S.offer.addRow}</Button></div>
                    <div className="sheet" data-testid="ladder">
                      {o.rows.map((r, j) => (
                        <div key={j} className="grid grid-cols-[1fr_1fr_1.5rem] items-center gap-2 px-3 py-1.5">
                          <Input value={r.qty} onChange={(e) => setOpt(i, { rows: o.rows.map((x, m) => (m === j ? { ...x, qty: e.target.value } : x)) })} inputMode="numeric" className="h-8 text-right font-mono" placeholder="qty" data-testid="ladder-qty" />
                          <Input value={r.price} onChange={(e) => setOpt(i, { rows: o.rows.map((x, m) => (m === j ? { ...x, price: e.target.value } : x)) })} inputMode="decimal" className="h-8 text-right font-mono" placeholder="0.0000" data-testid="ladder-price" />
                          <Button size="icon-xs" variant="ghost" type="button" aria-label="Remove" onClick={() => setOpt(i, { rows: o.rows.filter((_, m) => m !== j) })}><Trash2 /></Button>
                        </div>
                      ))}
                    </div>
                    {errors[`${k}.priceBreaks`] && <p className="mt-1 text-xs text-danger">{errors[`${k}.priceBreaks`]}</p>}
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    {plusFee ? <Field label={S.offer.fee} error={errors[`${k}.feeMinor`]}><Input value={o.fee} onChange={(e) => setOpt(i, { fee: e.target.value })} inputMode="decimal" className="text-right font-mono" data-testid="fee" /></Field> : <div className="text-xs text-muted-foreground self-end pb-2">{S.offer.feeHidden}</div>}
                    <Field label={<span className="inline-flex items-center gap-1"><Lock className="size-3" />{S.offer.factory}</span>}><div className="h-9 rounded-lg bg-section-alt px-3 py-2 text-right font-mono text-sm">{o.factoryE2 !== null ? formatUnitPrice({ minorE2: o.factoryE2, currency: "USD" }, { decimals: 4 }) : "—"}</div></Field>
                  </div>
                  <Field label={S.offer.deviations} className="mt-3" error={errors[`${k}.deviationsPlain`]}><Textarea rows={2} value={o.deviations} onChange={(e) => setOpt(i, { deviations: e.target.value })} placeholder="none at spec thickness" data-testid="deviations" /></Field>
                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    <Field label={S.offer.sampleCost}><Input value={o.sampleCost} onChange={(e) => setOpt(i, { sampleCost: e.target.value })} inputMode="decimal" className="text-right font-mono" placeholder="45.00" /></Field>
                    <Field label={S.offer.samplePaidBy}><select value={o.samplePaidBy} onChange={(e) => setOpt(i, { samplePaidBy: e.target.value as SamplePaidBy | "" })} className="h-9 rounded-lg border border-input bg-card px-3 text-sm"><option value="">—</option>{SAMPLE_PAID_BY.map((s) => <option key={s} value={s}>{s}</option>)}</select></Field>
                    <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" className="accent-green-600" checked={o.sampleRequired} onChange={(e) => setOpt(i, { sampleRequired: e.target.checked })} data-testid="sample-required" />{S.offer.sampleRequired}</label>
                  </div>
                  <Field label={S.offer.terms} className="mt-3"><Input value={o.terms} onChange={(e) => setOpt(i, { terms: e.target.value })} /></Field>
                  <Field label={<span className="inline-flex items-center gap-1.5">{S.offer.internalNote} <VisibilityBadge visibility="internal" /></span>} className="mt-3"><Input value={o.internalNote} onChange={(e) => setOpt(i, { internalNote: e.target.value })} /></Field>
                </div>
              );
            })}
          </div>

          {opts.length > 0 && (
            <div className="rounded-xl border border-border bg-card p-5">
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label={S.offer.incoterm} error={errors.incoterm}><select value={incoterm} onChange={(e) => setIncoterm(e.target.value)} className="h-9 rounded-lg border border-input bg-card px-3 text-sm" data-testid="offer-incoterm">{INCOTERMS.filter((i) => isAdmin || i === "FOB").map((i) => <option key={i}>{i}</option>)}</select></Field>
                <Field label={S.offer.port}><Input value={port} onChange={(e) => setPort(e.target.value)} data-testid="offer-port" /></Field>
                <Field label={S.offer.valid} error={errors.validUntil}><Input type="date" value={valid} onChange={(e) => setValid(e.target.value)} className="font-mono" data-testid="offer-valid" /></Field>
                <Field label={S.offer.note} className="sm:col-span-3"><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
              </div>
              {errors._ && <p className="mt-2 text-xs text-danger" data-testid="offer-error">{errors._}</p>}
              <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setPreview(true)} data-testid="preview-client"><Eye data-icon="inline-start" />{S.offer.preview}</Button>
                <Button type="button" variant="outline" disabled={pending} onClick={() => run(() => saveOfferAction(payload(), false), { success: (d) => `Draft ${d.offerRef} saved` })} data-testid="save-draft">{S.offer.saveDraft}</Button>
                <Button type="button" disabled={pending || !canSend} onClick={() => run(() => saveOfferAction(payload(), true), { success: (d) => `${d.offerRef} sent` })} data-testid="send-offer">{S.offer.send}{draft ? ` (v${draft.version})` : ""}</Button>
              </div>
            </div>
          )}
        </section>
      </div>

      {/* sent offers */}
      <section className="rounded-xl border border-border bg-card p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">{S.offer.sent}</h2>
          {accepted && line.state === "offer_accepted" && <Button asChild variant="green" size="sm" data-testid="confirm-order"><Link href={`/ops/orders/new?lineId=${encodeURIComponent(line.ref)}`}>{S.offer.confirmOrder}</Link></Button>}
        </div>
        {sent.length === 0 ? <p className="text-sm text-muted-foreground">—</p> : (
          <ul className="sheet" data-testid="sent-offers">
            {sent.map((o) => (
              <li key={o.id} className="sheet-row" data-offer={o.ref} data-status={o.status}>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-mono text-xs">{o.ref}</span><OfferStatusChip status={o.status} />
                  <span className="text-xs text-muted-foreground">sent {formatDate(o.sentAt)} · {o.incoterm} {o.port} · valid {formatDate(o.validUntil)}</span>
                  <span className="ml-auto text-xs" data-testid="offer-decision">
                    {o.status === "accepted" && o.acceptedOptionLabel && <span className="text-success">{S.offer.accepted(o.acceptedOptionLabel, formatDate(o.decidedAt))}</span>}
                    {o.status === "declined" && <span className="text-danger">{S.offer.declined(formatDate(o.decidedAt))}{o.declineReason ? ` · ${o.declineReason.replace(/_/g, " ")}` : ""}</span>}
                    {o.status === "changes_requested" && <span className="text-warning">{S.offer.changes(formatDate(o.decidedAt))}</span>}
                    {o.status === "expired" && <span className="text-muted-foreground">{S.offer.expired}</span>}
                    {o.status === "sent" && <span className="text-muted-foreground">{to("sent")}</span>}
                  </span>
                </div>
                {o.changesText && <p className="mt-1 text-xs text-ink-2">“{o.changesText}”</p>}
                <div className="mt-2 grid gap-2 sm:grid-cols-3">
                  {o.options.map((x) => (
                    <div key={x.id} className={cn("rounded-lg border px-3 py-2 text-xs", o.acceptedOptionLabel === x.label ? "border-green-200 bg-green-50" : "border-hairline-faint")} data-option={x.label}>
                      <div className="flex items-center justify-between"><UtilityBadge kind={o.acceptedOptionLabel === x.label ? "recommended" : "version"}>{x.label}</UtilityBadge><span className="inline-flex items-center gap-1 text-muted-foreground"><Lock className="size-3" />{x.supplierName ?? "—"}</span></div>
                      <div className="mt-1 font-mono">{ladderPriceAt(x.priceBreaks, line.qty) !== null ? formatUnitPrice({ minorE2: ladderPriceAt(x.priceBreaks, line.qty)!, currency: o.currency }) : "—"} @ {line.qty ? formatQty(line.qty) : "—"}{x.feeMinor ? ` · fee ${formatMoney({ minor: x.feeMinor, currency: o.currency })}` : ""}</div>
                      <div className="text-muted-foreground">MOQ {x.moq ? formatQty(x.moq) : "—"} · {x.leadDays ?? "—"} d{x.factoryPriceMinorE2 ? ` · factory ${formatUnitPrice({ minorE2: x.factoryPriceMinorE2, currency: "USD" }, { decimals: 4 })}` : ""}</div>
                      {x.deviationsPlain && <div className="text-ink-2">{x.deviationsPlain}</div>}
                    </div>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* preview as client */}
      <Sheet open={preview} onOpenChange={setPreview}>
        <SheetContent side="right" className="sm:max-w-[40rem] overflow-y-auto p-6">
          <SheetHeader className="p-0 text-left"><SheetTitle>{S.offer.preview}</SheetTitle><SheetDescription>Rendered from the client DTO shape — no supplier attributes.</SheetDescription></SheetHeader>
          <div className="mt-4 flex flex-col gap-4" data-dto="ClientOfferDto" data-testid="client-preview">
            <div><Eyebrow>OFFER · {line.ref} · VALID UNTIL {formatDate(valid).toUpperCase()}</Eyebrow><h3 className="mt-1 text-lg font-semibold">Price for {line.name}</h3></div>
            {opts.map((o, i) => {
              const at = ladderPriceAt(o.rows.map((r) => ({ min_qty: Number(r.qty) || 0, unit_price_minor_e2: parsePriceE2(r.price) ?? 0 })), line.qty);
              return (
                <div key={i} className="rounded-2xl border border-border bg-card p-5" data-option={LABELS[i]}>
                  <Eyebrow variant="pill">OPTION {LABELS[i]}</Eyebrow>
                  <div className="mt-2 font-mono text-2xl font-medium">{at ? formatUnitPrice({ minorE2: at, currency: "USD" }) : "—"}<span className="text-sm font-normal text-muted-foreground"> / {line.unit}</span></div>
                  {plusFee && <div className="font-mono text-sm text-ink-2">+ {formatMoney({ minor: parseAmountMinor(o.fee) ?? 0, currency: "USD" })} fee</div>}
                  <dl className="mt-3 text-sm">
                    {[["MOQ", o.moq ? formatQty(Number(o.moq), line.unit) : "—"], ["Lead time", o.lead ? `${o.lead} days` : "—"], ["Payment terms", o.terms], ["Sample", o.sampleCost ? `${formatMoney({ minor: parseAmountMinor(o.sampleCost) ?? 0, currency: "USD" })} · paid by ${o.samplePaidBy || "—"}` : "—"], ["Sample before order", o.sampleRequired ? "yes" : "no"], ["Incoterm", `${incoterm} ${port}`]].map(([l, v]) => (
                      <div key={l} className="flex justify-between border-b border-hairline-faint py-2 last:border-b-0"><dt className="text-xs text-muted-foreground">{l}</dt><dd className="font-mono text-[13px]">{v}</dd></div>
                    ))}
                  </dl>
                  <p className="mt-2 text-sm text-ink-2">{o.deviations || "—"}</p>
                </div>
              );
            })}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
