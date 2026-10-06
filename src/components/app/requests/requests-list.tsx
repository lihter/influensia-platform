"use client";
import * as React from "react";
import Link from "next/link";
import { Search, Triangle, FileText, Inbox } from "lucide-react";
import type { ClientRequestListDto, ClientListRowDto, ClientListTabDto } from "@/server/client/dto/requests";
import { MILESTONES } from "@/db/enums";
import { MilestoneChip, ExceptionChip, UtilityBadge } from "@/components/shared/chips";
import { EmptyState } from "@/components/shared/empty-state";
import { Qty, Ref } from "@/components/shared/formatters";
import { fmtDateShort } from "@/lib/format-date";
import { unitLabel } from "@/lib/labels";
import { chipLabel, nextStepFor } from "../client-format";
import { NextShort } from "../now-next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table";
import { MediaCell } from "@/components/shared/media";
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
 * F-05 — Requests: tabs Active · Waiting on you · Delivered · Drafts, search by ref/name, one table (picture first,
 * sorted by milestone). Row → line page / order page / draft request.
 */
export function RequestsList({ dto, tab }: { dto: ClientRequestListDto; tab: ClientListTabDto }) {
  const [q, setQ] = React.useState("");
  const needle = q.trim().toLowerCase();
  const rows = dto.rows.filter((r) => inTab(r, tab)).filter((r) => !needle || r.name.toLowerCase().includes(needle) || r.ref.toLowerCase().includes(needle) || (r.orderRef ?? "").toLowerCase().includes(needle) || r.requestRef.toLowerCase().includes(needle));
  const columns: DataTableColumn<ClientListRowDto>[] = [
    {
      id: "product", header: "Product", accessorFn: (r) => r.name,
      cell: ({ row: { original: r } }) => (
        <MediaCell
          image={r.image} name={r.name} domain={r.linkDomain} size="lg" variant="comfortable" textWidth="max-w-[40ch]"
          overline={
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <Ref muted>{r.displayRef}</Ref>
              {!r.orderRef && !r.isDraft && <Link href={`/app/requests/${r.requestRef}`} onClick={(e) => e.stopPropagation()} className="relative z-10 font-mono text-xs text-muted-foreground underline-offset-[3px] hover:text-foreground hover:underline" data-testid="request-link">{r.requestRef} ›</Link>}
              {r.isRepeat && <UtilityBadge kind="repeat">Repeat</UtilityBadge>}
            </div>
          }
          title={<Link href={r.href} onClick={(e) => e.stopPropagation()} className="hover:underline" title={r.name}>{r.name}</Link>}
          extra={<div className="truncate text-xs text-ink-2" title={r.exceptionText ?? r.subLabel} data-testid="status-detail">{r.exceptionText ?? r.subLabel}</div>}
        />
      ),
      meta: { sticky: true },
    },
    { id: "qty", header: "Qty", accessorFn: (r) => r.qty ?? -1, cell: ({ row: { original: r } }) => (r.qty !== null ? <Qty qty={r.qty} unit={unitLabel(r.unit, r.qty)} /> : <span className="text-muted-foreground">—</span>), meta: { numeric: true } },
    { id: "status", header: "Status", accessorFn: (r) => MILESTONES.indexOf(r.milestone), cell: ({ row: { original: r } }) => (r.exception ? <ExceptionChip exception={r.exception} client /> : <MilestoneChip milestone={r.milestone} waitingOnClient={!!r.waitingReason} label={chipLabel(r)} />) },
    {
      id: "next", header: "Next", enableSorting: false,
      cell: ({ row: { original: r } }) => {
        const step = nextStepFor({ milestone: r.milestone, state: r.state, waitingReason: r.waitingReason, exception: r.exception, offerOutcome: r.offerOutcome, sourcing: r.sourcingProgress, since: r.lastChangeAt, isRepeat: r.isRepeat, etaLabel: r.etaLabel });
        return step.short && !r.isDraft ? <NextShort step={step} className="font-mono" /> : <span className="font-mono text-xs text-muted-foreground">{r.isDraft ? "Draft" : "—"}</span>;
      },
    },
    { id: "updated", header: "Updated", accessorFn: (r) => r.updatedAt, cell: ({ row: { original: r } }) => <span className="font-mono text-xs text-muted-foreground">{fmtDateShort(r.updatedAt)}</span>, meta: { numeric: true } },
  ];

  return (
    <div className="flex flex-col gap-5" data-testid="requests-list">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <nav className="-mx-4 flex gap-6 overflow-x-auto border-b border-border px-4 [mask-image:linear-gradient(to_right,black_85%,transparent)] sm:mx-0 sm:px-0 sm:[mask-image:none]" aria-label="List tabs" role="tablist">
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
        <DataTable columns={columns} data={rows} rowHref={(r) => r.href} rowProps={(r) => ({ "data-testid": "list-row", "data-ref": r.ref, "data-list-group": r.milestone })} data-testid="requests-table" />
      )}
    </div>
  );
}
