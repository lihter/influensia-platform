"use client";
import * as React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ChevronDown, ChevronRight, Clock, Mail, MessageCircle, Globe, Phone, AlertTriangle, Paperclip, MoreHorizontal, Star, Plus } from "lucide-react";
import type { OpsLine, OpsParticipation, OpsQuote } from "@/server/ops/participations";
import type { ParticipationStatus } from "@/db/enums";
import { formatUnitPrice, formatQty } from "@/server/shared/money";
import { fmtDate as formatDate } from "@/lib/format-date";
import { ParticipationChip } from "@/components/shared/chips";
import { label } from "@/lib/labels";
import { PriceStrip, type StripPoint } from "./price-strip";
import { FactoryLabel } from "@/components/shared/factory-label";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { S, CHANNEL_LABEL } from "./strings";
import { compactQty } from "./pure";
import { AddSupplierSheet, LogQuoteSheet, StatusDialog, NotesSheet, RfqDialog, ShortlistDialog, STATUS_OPTIONS } from "./board-sheets";

const ChannelIcon = ({ ch }: { ch: string }) => ch === "email" ? <Mail className="size-3.5" /> : ch === "wechat" || ch === "whatsapp" ? <MessageCircle className="size-3.5" /> : ch === "phone" ? <Phone className="size-3.5" /> : <Globe className="size-3.5" />;
const usd = (e2: number) => formatUnitPrice({ minorE2: e2, currency: "USD" }, { decimals: 4 });
const money = (e2: number, currency: string) => formatUnitPrice({ minorE2: e2, currency }, { decimals: 4 });
const FLAG_LABEL: Record<string, string> = { expired: "expired", incoterm_uncertain: "incoterm?", unit_mismatch: "unit", currency_unknown: "fx?", supplier_unchecked: "unchecked", supplier_trading: "trading", excluded_status: "excluded", moq_above_qty: "MOQ > qty", deviation: "deviation" };

function terms(q: OpsQuote | null) {
  if (!q) return "—";
  const parts = [q.incoterm ? `${q.incoterm}${q.incotermUncertain ? "?" : ""}${q.port ? ` ${q.port}` : ""}` : null, q.leadDays ? `${q.leadDays}${q.leadDaysMax ? `–${q.leadDaysMax}` : ""} d` : null, q.paymentTerms].filter(Boolean);
  return parts.join(" · ") || "—";
}

/** SPEC F-17 / DESIGN §6.9 — the sheet, structured: compare strip, board table with in-cell status, expandable quote versions. */
export function SourcingBoard({ line }: { line: OpsLine }) {
  const tm = useTranslations("milestone");
  const ts = useTranslations("participation_status");
  const [addOpen, setAddOpen] = React.useState(false);
  const [quoteFor, setQuoteFor] = React.useState<{ open: boolean; p: OpsParticipation | null }>({ open: false, p: null });
  const [status, setStatus] = React.useState<{ open: boolean; p: OpsParticipation | null; status: ParticipationStatus | null }>({ open: false, p: null, status: null });
  const [notes, setNotes] = React.useState<{ open: boolean; p: OpsParticipation | null }>({ open: false, p: null });
  const [rfqOpen, setRfqOpen] = React.useState(false);
  const [shortOpen, setShortOpen] = React.useState(false);
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const c = line.compare;
  const toggle = (set: React.Dispatch<React.SetStateAction<Set<string>>>, id: string) => set((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const canRfq = line.state === "spec_frozen" || line.state === "cost_target_price";
  const buildHref = `/ops/lines/${line.ref}?tab=offer${selected.size ? `&parts=${[...selected].join(",")}` : ""}`;
  const [hoveredId, setHoveredId] = React.useState<string | null>(null);
  const pick = (id: string) => { document.querySelector(`[data-testid=board-row][data-pid="${id}"]`)?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" }); setHoveredId(id); };
  const stripPoints: StripPoint[] = line.participations.filter((p) => p.usdMinorE2 !== null).map((p) => ({ id: p.id, label: p.supplier.legalName, usdMinorE2: p.usdMinorE2 as number, status: p.status, flagged: p.flags.some((f) => f !== "excluded_status") }));

  return (
    <div className="flex flex-col gap-4" data-testid="sourcing-board">
      {/* compare bar */}
      <div className="overflow-hidden rounded-t-xl border border-b-0 border-hairline-strong">
      <div className="bg-section-alt px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1" data-testid="compare-strip">
            <span className="text-ink-2">{S.board.costFloor} <span className="font-mono font-medium text-foreground">{line.costModel ? usd(line.costModel.est_prod_cost_minor_e2) : "—"}</span></span>
            <span className="text-ink-2">{S.board.target} {line.targetPriceMinorE2 ? <span className="font-mono font-medium text-foreground" data-testid="board-target">{usd(line.targetPriceMinorE2)} /{line.unit}</span> : <span className="inline-flex items-center gap-1 text-warning"><AlertTriangle className="size-3.5" />{S.board.noTarget}</span>}</span>
            {line.qty && <span className="text-ink-2">Qty <span className="font-mono font-medium text-foreground">{formatQty(line.qty, line.unit)}</span></span>}
            <span className="h-4 w-px bg-hairline-strong" aria-hidden />
            <span className="text-ink-2">{S.board.bestClean} <span className="font-mono font-medium text-green-700">{c.bestClean ? usd(c.bestClean.usdMinorE2) : "—"}</span>{c.bestClean && <span className="text-muted-foreground"> ({c.bestClean.label})</span>}</span>
            <span className="text-ink-2">{S.board.lowest} <span className="font-mono font-medium text-foreground">{c.lowestQuoted ? usd(c.lowestQuoted.usdMinorE2) : "—"}</span>{c.lowestQuoted && <span className="text-muted-foreground"> ({c.lowestQuoted.label}{c.lowestQuoted.excluded.length ? <span className="text-warning" title={c.lowestQuoted.excluded.join(", ")}>, {S.board.excluded}: {c.lowestQuoted.excluded.slice(0, 2).join(", ")}{c.lowestQuoted.excluded.length > 2 ? ` +${c.lowestQuoted.excluded.length - 2} more` : ""}</span> : null})</span>}</span>
            <span className="text-ink-2">{S.board.spread} <span className="font-mono font-medium text-foreground">{c.spread !== null ? `${c.spread}×` : "—"}</span></span>
            <span className="text-ink-2"><span className="font-mono font-medium text-foreground">{c.quotesCount}</span> quotes of <span className="font-mono font-medium text-foreground">{c.contactedCount}</span> contacted</span>
            <span className="text-ink-2"><span className={cn("font-mono font-medium", c.staleCount ? "text-warning" : "text-foreground")}>{c.staleCount}</span> stale</span>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setAddOpen(true)} data-testid="add-supplier"><Plus />Supplier</Button>
            <Button size="sm" variant="outline" onClick={() => setQuoteFor({ open: true, p: null })} disabled={!line.participations.length} data-testid="log-quote">{S.board.logQuote}</Button>
            <Button size="sm" variant="outline" onClick={() => setShortOpen(true)} disabled={!selected.size} title={selected.size ? undefined : "Tick suppliers in the table first"} data-testid="shortlist">{S.board.shortlist}{selected.size ? ` (${selected.size})` : ""}</Button>
            {canRfq && <Button size="sm" variant="outline" onClick={() => setRfqOpen(true)} data-testid="mark-rfq">{S.board.markRfq}</Button>}
            {selected.size > 0 && <Button size="sm" variant="ghost" asChild><Link href={buildHref} data-testid="build-offer">{S.board.buildOffer} with {selected.size}</Link></Button>}
          </div>
        </div>
      </div>
      <PriceStrip points={stripPoints} floorE2={line.costModel?.est_prod_cost_minor_e2 ?? null} targetE2={line.targetPriceMinorE2 ?? null} unit={line.unit} hoveredId={hoveredId} onHover={setHoveredId} onPick={pick} />
      </div>

      {/* table */}
      <div className="scroll-shadow-x -mt-4 overflow-auto rounded-b-xl border border-border" style={{ maxHeight: "calc(100vh - 12rem)" }}>
        {line.participations.length === 0 ? (
          <EmptyState title={S.board.empty} body={`${S.board.emptyBody}${line.links.length ? ` Client links: ${line.links.map((l) => l.domain).join(", ")}.` : ""}`} action={<Button onClick={() => setAddOpen(true)}>{S.board.addSupplier}</Button>} />
        ) : (
          <table className="w-full border-separate border-spacing-0 text-sm" data-testid="board-table">
            <thead>
              <tr>
                {[["", "w-8"], ["", "w-8"], [S.board.col.supplier, "sticky left-0 z-30"], [`${S.board.col.type} · ${S.board.col.grade}`, ""], [S.board.col.contact, ""], [S.board.col.status, ""], [`${S.board.col.price} · terms`, "text-right"], [S.board.col.usd, "text-right"], [S.board.col.last, "text-right"], [S.board.col.notes, ""], ["", "w-10"]].map(([h, cls], i) => (
                  <th key={i} scope="col" className={cn("sticky top-0 z-20 h-9 bg-card px-3 text-left align-middle text-2xs font-semibold uppercase tracking-[0.06em] whitespace-nowrap text-foreground rule-ink", cls)}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {line.participations.map((p) => {
                const q = p.latestQuote;
                const excluded = p.status === "dropped" || p.status === "cannot_make";
                const isOpen = expanded.has(p.id);
                return (
                  <React.Fragment key={p.id}>
                    <tr data-testid="board-row" data-status={p.status} data-supplier={p.supplier.ref} data-pid={p.id}
                      onMouseEnter={() => setHoveredId(p.id)} onMouseLeave={() => setHoveredId(null)}
                      className={cn("group/row transition-colors duration-[120ms] hover:bg-surface-sunken", hoveredId === p.id && "bg-surface-sunken", excluded && "opacity-60", p.isSelected && "bg-green-50 shadow-[inset_3px_0_0_var(--green-600)]", !p.isSelected && p.stale && "shadow-[inset_3px_0_0_var(--warning-border)]")}>
                      <td className="border-b border-hairline-faint px-2"><input type="checkbox" className="accent-green-600" checked={selected.has(p.id)} onChange={() => toggle(setSelected, p.id)} aria-label={`select ${p.supplier.legalName}`} /></td>
                      <td className="border-b border-hairline-faint px-1"><Button size="icon-xs" variant="ghost" aria-label="Expand" aria-expanded={isOpen} onClick={() => toggle(setExpanded, p.id)} data-testid="expand">{isOpen ? <ChevronDown /> : <ChevronRight />}</Button></td>
                      <td className={cn("sticky left-0 z-10 border-b border-hairline-faint bg-card px-3 py-2 group-hover/row:bg-surface-sunken", hoveredId === p.id && "bg-surface-sunken", p.isSelected && "bg-green-50")}>
                        <div className="max-w-[24ch]">
                          <div className="flex items-center gap-2"><span className="truncate font-medium text-foreground" title={p.supplier.legalName}>{p.supplier.legalName}</span></div>
                          <div className="flex items-center gap-2 truncate font-mono text-xs text-muted-foreground"><span>{p.supplier.ref}</span>{p.supplier.cnName && <span className="truncate font-sans" title={p.supplier.cnName}>{p.supplier.cnName}</span>}{p.supplier.factoryLabel && <FactoryLabel label={p.supplier.factoryLabel} disclosed={p.supplier.disclosed} />}</div>
                        </div>
                      </td>
                      <td className="border-b border-hairline-faint px-3 text-xs whitespace-nowrap">
                        <span className="inline-flex items-center gap-2">
                          <span className={(p.supplier.typeVerdict === "unchecked" || p.supplier.typeVerdict === "unknown") ? "text-faint" : "text-ink-2"}>{label("supplierVerdict", p.supplier.typeVerdict)}</span>
                          {p.supplier.grade && <span className="inline-flex size-5 items-center justify-center rounded-full border border-hairline-strong font-mono text-xs" title={`Grade ${p.supplier.grade}`}>{p.supplier.grade}</span>}
                        </span>
                      </td>
                      <td className="border-b border-hairline-faint px-3 text-xs">
                        {p.contact ? <span className="inline-flex max-w-[14ch] items-center gap-1.5" title={`${p.contact.name ?? ""} · ${CHANNEL_LABEL[p.contact.channel]}${p.contact.handle ? ` · ${p.contact.handle}` : ""}`}><ChannelIcon ch={p.contact.channel} /><span className="truncate">{p.contact.name ?? CHANNEL_LABEL[p.contact.channel]}</span></span> : <span className="text-faint">—</span>}
                      </td>
                      <td className="border-b border-hairline-faint px-3">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button type="button" className="group/chip inline-flex items-center gap-1 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid="status-trigger" aria-label={`status ${ts(p.status)}`}>
                              <ParticipationChip status={p.status} /><ChevronDown className="size-3 text-muted-foreground opacity-0 group-hover/chip:opacity-100" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start">
                            <DropdownMenuRadioGroup value={p.status} onValueChange={(v) => setStatus({ open: true, p, status: v as ParticipationStatus })}>
                              {STATUS_OPTIONS.map((s) => <DropdownMenuRadioItem key={s} value={s} data-testid={`status-${s}`}>{ts(s)}</DropdownMenuRadioItem>)}
                            </DropdownMenuRadioGroup>
                          </DropdownMenuContent>
                        </DropdownMenu>
                        {p.reason && <div className="mt-0.5 max-w-[24ch] truncate text-2xs text-muted-foreground" title={p.reason}>{p.reason}</div>}
                      </td>
                      <td className="border-b border-hairline-faint px-3 text-right font-mono text-[13px] tabular-nums whitespace-nowrap text-ink-2" data-testid="price-cell">
                        {q && q.breaks.length ? (
                          <Tooltip><TooltipTrigger asChild><span>{money(q.breaks[0].unitPriceMinorE2, q.currency)} @ {compactQty(q.breaks[0].minQty)}{q.unit !== line.unit ? ` ${q.unit}` : ""}</span></TooltipTrigger>
                            <TooltipContent>{q.breaks.map((b) => `${formatQty(b.minQty)} → ${money(b.unitPriceMinorE2, q.currency)}/${q.unit}`).join(" · ")}{q.packQty ? ` · pack ${q.packQty}` : ""}</TooltipContent></Tooltip>
                        ) : <span className="text-faint">—</span>}
                        {q && <div className="mt-0.5 max-w-[26ch] truncate font-sans text-2xs text-muted-foreground" title={terms(q)}>{terms(q)}</div>}
                      </td>
                      <td className="border-b border-hairline-faint px-3 text-right font-mono text-[13px] tabular-nums whitespace-nowrap" data-testid="usd-cell">
                        {p.usdMinorE2 !== null ? (
                          <Tooltip><TooltipTrigger asChild><span className={cn("font-medium", p.isBestClean ? "text-green-700" : excluded ? "text-muted-foreground line-through" : "text-foreground")}>{usd(p.usdMinorE2)}</span></TooltipTrigger>
                            <TooltipContent>{q?.fxRate && q.fxRate !== 1 ? `${q.fxRate} @ ${q.fxDate}` : "USD"}{p.flags.length ? ` · ${p.flags.map((f) => FLAG_LABEL[f] ?? f).join(", ")}` : " · clean"}</TooltipContent></Tooltip>
                        ) : <span className="text-faint">—</span>}
                        {p.flags.filter((f) => f !== "excluded_status").length > 0 && (
                          <Tooltip><TooltipTrigger asChild><span className="ml-1.5 inline-flex translate-y-0.5 text-warning" aria-label={`Flags: ${p.flags.filter((f) => f !== "excluded_status").map((f) => FLAG_LABEL[f] ?? f).join(", ")}`} data-flags={p.flags.join(",")}><AlertTriangle className="size-3.5" /></span></TooltipTrigger>
                            <TooltipContent>{p.flags.filter((f) => f !== "excluded_status").map((f) => FLAG_LABEL[f] ?? f).join(" · ")}</TooltipContent></Tooltip>
                        )}
                      </td>
                      <td className="border-b border-hairline-faint px-3 text-right font-mono text-[13px] tabular-nums whitespace-nowrap" data-testid="last-cell">
                        {p.daysSinceContact !== null ? <span className={cn("inline-flex items-center gap-1", p.stale ? "font-medium text-warning" : "text-ink-2")}>{p.daysSinceContact} d{p.stale && <Clock className="size-3" />}</span> : "—"}
                      </td>
                      <td className="border-b border-hairline-faint px-3 text-xs text-ink-2"><button type="button" className="block max-w-[14ch] truncate text-left hover:underline" title={p.notes ?? ""} onClick={() => setNotes({ open: true, p })}>{p.notes || <span className="text-faint">{S.board.editNote}…</span>}</button></td>
                      <td className="border-b border-hairline-faint px-2 text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild><Button size="icon-xs" variant="ghost" aria-label="Row actions" data-testid="row-menu"><MoreHorizontal /></Button></DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => setQuoteFor({ open: true, p })} data-testid="row-log-quote">{S.board.logQuote}</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setNotes({ open: true, p })}>{S.board.editNote}</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setStatus({ open: true, p, status: "shortlisted" })}><Star />{S.board.shortlist}</DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => setStatus({ open: true, p, status: "selected" })}>Mark selected</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setStatus({ open: true, p, status: "backup" })}>Mark backup</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setStatus({ open: true, p, status: "dropped" })}>Drop</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr data-testid="expanded-row">
                        <td colSpan={11} className="border-b border-hairline-faint bg-section-alt px-6 py-4">
                          <div className="mb-2 flex items-center justify-between"><span className="eyebrow">{S.board.versions} · {p.supplier.legalName}</span><Button size="sm" variant="outline" onClick={() => setQuoteFor({ open: true, p })}>{S.board.logQuote}</Button></div>
                          {p.quotes.length === 0 ? <p className="text-xs text-muted-foreground">{S.board.noQuote}</p> : (
                            <ul className="sheet">
                              {p.quotes.map((v) => (
                                <li key={v.id} className="sheet-row grid gap-x-6 gap-y-1 text-xs sm:grid-cols-[6rem_1fr_1fr]">
                                  <div><span className="font-mono font-medium">v{v.version}</span><div className="text-muted-foreground">{formatDate(v.receivedAt)}</div></div>
                                  <div className="space-y-0.5">
                                    <div>{v.incoterm ?? "—"}{v.incotermUncertain && <span className="ml-1 rounded border border-warning-border bg-warning-wash px-1 text-[10px] text-warning">?</span>} {v.port ?? ""} · MOQ <span className="font-mono">{v.moq ? formatQty(v.moq) : "—"}</span> · lead <span className="font-mono">{v.leadDays ?? "—"}{v.leadDaysMax ? `–${v.leadDaysMax}` : ""} d</span> · valid <span className="font-mono">{v.validUntil ? formatDate(v.validUntil) : "—"}</span></div>
                                    <div>{v.paymentTerms ?? "—"}{v.unitWeightG ? ` · ${v.unitWeightG} g` : ""}{v.carton ? ` · ${v.carton}` : ""}</div>
                                    {v.deviations && <div className="text-ink-2">dev: {v.deviations}</div>}
                                    {v.notes && <div className="text-muted-foreground">{v.notes}</div>}
                                  </div>
                                  <div className="space-y-0.5 font-mono">
                                    {v.breaks.map((b) => <div key={b.minQty}>{formatQty(b.minQty)} → {money(b.unitPriceMinorE2, v.currency)}/{v.unit}{v.packQty ? ` (pack ${v.packQty})` : ""}</div>)}
                                    <div className="text-muted-foreground">= {v.normalisedUsdMinorE2 !== null ? `${usd(v.normalisedUsdMinorE2)}/${line.unit}` : "—"}{v.fxRate && v.fxRate !== 1 ? ` · ${v.fxRate} @ ${v.fxDate}` : ""}</div>
                                    {v.sourceDocument && <a href={v.sourceDocument.href} className="inline-flex items-center gap-1 font-sans text-foreground hover:underline"><Paperclip className="size-3" />{v.sourceDocument.filename}</a>}
                                  </div>
                                </li>
                              ))}
                            </ul>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <p className="text-xs text-muted-foreground">Client sees: <span className="font-mono">{c.contactedCount} contacted · {c.quotesCount} quoted</span> · {tm(line.milestone)}</p>

      <AddSupplierSheet line={line} open={addOpen} onOpenChange={setAddOpen} />
      {quoteFor.open && <LogQuoteSheet key={quoteFor.p?.id ?? "any"} line={line} participation={quoteFor.p} open={quoteFor.open} onOpenChange={(o) => setQuoteFor((s) => ({ ...s, open: o }))} />}
      {status.open && <StatusDialog key={`${status.p?.id}:${status.status}`} participation={status.p} status={status.status} open={status.open} onOpenChange={(o) => setStatus((s) => ({ ...s, open: o }))} />}
      {notes.open && <NotesSheet key={notes.p?.id} participation={notes.p} open={notes.open} onOpenChange={(o) => setNotes((s) => ({ ...s, open: o }))} />}
      {rfqOpen && <RfqDialog line={line} open={rfqOpen} onOpenChange={setRfqOpen} />}
      {shortOpen && <ShortlistDialog line={line} ids={[...selected]} open={shortOpen} onOpenChange={setShortOpen} onDone={() => setSelected(new Set())} />}
    </div>
  );
}
