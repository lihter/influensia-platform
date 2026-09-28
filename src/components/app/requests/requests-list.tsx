"use client";
import * as React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowRight, Search, Triangle, FileText, Inbox } from "lucide-react";
import type { ClientRequestListDto, ClientListRowDto, ClientListTabDto } from "@/server/client/dto/requests";
import { MILESTONES } from "@/db/enums";
import { MilestoneChip, ExceptionChip, UtilityBadge } from "@/components/shared/chips";
import { MilestoneBar } from "@/components/shared/milestone-stepper";
import { EmptyState } from "@/components/shared/empty-state";
import { Qty, Ref, DateTime } from "@/components/shared/formatters";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { S } from "./strings";

const T = S.list;
const TABS: ClientListTabDto[] = ["active", "waiting", "delivered", "drafts"];

function inTab(r: ClientListRowDto, tab: ClientListTabDto) {
  if (tab === "drafts") return r.isDraft;
  if (tab === "waiting") return !!r.waitingReason && !r.isDraft;
  if (tab === "delivered") return !r.isDraft && (r.isClosed || r.milestone === "delivered");
  return !r.isDraft && !r.isClosed && r.milestone !== "delivered";
}

/**
 * F-05 — Requests & orders: tabs Active · Waiting on you · Delivered · Drafts, search by ref/name, rows sectioned by
 * milestone (sheet lists with numbered eyebrow headers, like the dashboard). Row → line page / order page / draft request.
 */
export function RequestsList({ dto, tab }: { dto: ClientRequestListDto; tab: ClientListTabDto }) {
  const tm = useTranslations("milestone");
  const [q, setQ] = React.useState("");
  const needle = q.trim().toLowerCase();
  const rows = dto.rows.filter((r) => inTab(r, tab)).filter((r) => !needle || r.name.toLowerCase().includes(needle) || r.ref.toLowerCase().includes(needle) || (r.orderRef ?? "").toLowerCase().includes(needle) || r.requestRef.toLowerCase().includes(needle));
  const groups = tab === "delivered"
    ? [{ key: "delivered", label: tm("delivered"), number: 9, rows: rows.filter((r) => !r.isClosed) }, { key: "closed", label: T.closed, number: undefined, rows: rows.filter((r) => r.isClosed) }].filter((g) => g.rows.length)
    : tab === "drafts"
      ? [{ key: "drafts", label: T.tabs.drafts, number: undefined, rows }]
      : MILESTONES.map((m) => ({ key: m, label: tm(m), number: MILESTONES.indexOf(m) + 1, rows: rows.filter((r) => r.milestone === m) })).filter((g) => g.rows.length);

  return (
    <div className="flex flex-col gap-5" data-testid="requests-list">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <nav className="-mx-4 flex gap-6 overflow-x-auto border-b border-border px-4 sm:mx-0 sm:px-0" aria-label="List tabs" role="tablist">
          {TABS.map((t) => (
            <Link key={t} href={t === "active" ? "/app/requests" : `/app/requests?tab=${t}`} role="tab" aria-selected={t === tab} data-testid={`tab-${t}`}
              className={cn("relative inline-flex h-10 shrink-0 items-center gap-1.5 border-b-2 pb-3 pt-2 text-sm whitespace-nowrap transition-colors", t === tab ? "border-green-600 font-semibold text-foreground" : "border-transparent text-ink-2 hover:text-foreground")}>
              {t === "waiting" && dto.counts.waiting > 0 && <Triangle className="size-2 fill-green-600 text-green-600" />}
              {T.tabs[t]} <span className="font-mono text-xs text-muted-foreground">{dto.counts[t]}</span>
            </Link>
          ))}
        </nav>
        <div className="relative sm:w-64">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={T.search} aria-label={T.search} className="h-10 pl-8 sm:h-9" data-testid="list-search" />
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-border bg-card">
          {needle
            ? <EmptyState icon={Search} title={T.noMatch} action={<Button variant="outline" onClick={() => setQ("")}>Clear search</Button>} />
            : <EmptyState icon={tab === "drafts" ? FileText : Inbox} title={T.empty[tab]} body={T.emptyHint[tab]} action={tab === "active" || tab === "drafts" ? <Button asChild><Link href="/app/requests/new">{T.newRequest}</Link></Button> : undefined} />}
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {groups.map((g) => (
            <section key={g.key} data-list-group={g.key} aria-label={g.label}>
              <div className="mb-1.5 flex items-center gap-2 text-2xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                {g.number !== undefined && <><span className="font-mono">{String(g.number).padStart(2, "0")}</span> ·</>} {g.label} <span className="font-mono">{g.rows.length}</span>
              </div>
              <ul className="sheet">
                {g.rows.map((r) => (
                  <li key={r.id} className="list-none">
                    <Link href={r.href} className="sheet-row grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2 transition-colors duration-[120ms] hover:bg-surface-sunken md:grid-cols-[minmax(0,1fr)_7rem_auto_6rem_11rem_auto]" data-testid="list-row" data-ref={r.ref}>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Ref muted>{r.displayRef}</Ref>
                          {r.isRepeat && <UtilityBadge kind="repeat">Repeat</UtilityBadge>}
                        </div>
                        <div className="truncate text-sm font-medium text-foreground">{r.name}</div>
                        <div className="text-xs text-ink-2 md:hidden">
                          {r.qty !== null && <><Qty qty={r.qty} unit={r.unit} /> · </>}
                          <span>{r.exceptionText ?? r.subLabel}</span>
                        </div>
                      </div>
                      <div className="hidden text-right md:block">{r.qty !== null ? <Qty qty={r.qty} unit={r.unit} className="text-[13px] text-ink-2" /> : <span className="text-faint">—</span>}</div>
                      <div className="flex flex-col items-end gap-1 md:items-start">
                        <MilestoneChip milestone={r.milestone} waitingOnClient={!!r.waitingReason} />
                        {r.exception && <ExceptionChip exception={r.exception} client />}
                      </div>
                      <div className="hidden pt-2 md:block"><MilestoneBar milestone={r.milestone} /></div>
                      <div className="hidden min-w-0 md:block">
                        <p className="truncate text-xs text-ink-2" title={r.subLabel} data-testid="status-detail">{r.exceptionText ?? r.subLabel}</p>
                        <p className="truncate font-mono text-xs text-muted-foreground">{r.etaLabel ?? <DateTime value={r.updatedAt} variant="short" />}</p>
                      </div>
                      <div className="col-span-2 flex items-center justify-between text-xs text-ink-2 md:col-span-1 md:justify-end md:gap-2">
                        <span className="font-mono md:hidden">{r.etaLabel ?? <DateTime value={r.updatedAt} variant="short" />}</span>
                        <ArrowRight className="size-4 text-faint" />
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
