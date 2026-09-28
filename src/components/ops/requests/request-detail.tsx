"use client";
import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, ChevronDown, ExternalLink, AlertCircle, Image as ImageIcon, Eye, MessageCircle } from "lucide-react";
import type { OpsRequestDetail, OpsRequestLine, Agent } from "@/server/ops/requests";
import type { ActionResult } from "@/server/shared/http";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable, PrimaryCell, type DataTableColumn } from "@/components/shared/data-table";
import { StateChip, MilestoneChip, ExceptionChip, UtilityBadge } from "@/components/shared/chips";
import { Timeline, type TimelineEntry } from "@/components/shared/timeline";
import { DocumentRow } from "@/components/shared/document-row";
import { EmptyState } from "@/components/shared/empty-state";
import { Eyebrow } from "@/components/shared/eyebrow";
import { Qty, DateTime, Age } from "@/components/shared/formatters";
import { eventText } from "@/server/shared/labels";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { AgentCell, SourceBadge } from "./queue-table";
import { StateRollup } from "./requests-table";
import { O } from "./strings";
import { cn } from "@/lib/utils";
import { label as labelOf, nextStepLabel } from "@/lib/labels";
import { PageBand } from "@/components/shared/section-band";
import { EyebrowLink } from "@/components/shared/page-header";

type Claim = (input: { lineId: string }) => Promise<ActionResult<{ lineRef: string }>>;
type Assign = (input: { lineIds: string[]; agentId: string }) => Promise<ActionResult<{ lineRefs: string[]; agentName: string }>>;

/** Rail fact row: words in Figtree, only numbers/dates/refs in mono (`mono`). */
function Fact({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-hairline-faint py-2 last:border-b-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn("text-right text-sm text-foreground", mono && "font-mono text-[13px]")}>{children}</span>
    </div>
  );
}

/**
 * Ops request page (SPEC 2.3 `/ops/requests/[reqRef]`): sticky header (ref · client · status), lines table with
 * state / waiting / stale / agent + Claim / Assign, client note, right rail with client facts; tabs Notes · Documents · Activity.
 */
export function OpsRequestDetailView({ dto, me, claim, assign }: { dto: OpsRequestDetail; me: { id: string; name: string }; claim: Claim; assign: Assign }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [pending, start] = React.useTransition();
  const D = O.detail;

  const doClaim = (l: OpsRequestLine) => { setBusy(l.lineId); start(async () => { const r = await claim({ lineId: l.lineId }); setBusy(null); if (r.ok) { toast.success(`${O.assignedToYou} · ${r.data.lineRef}`); router.refresh(); } else toast.error(r.error); }); };
  const doAssign = (l: OpsRequestLine, a: Agent) => { setBusy(l.lineId); start(async () => { const r = await assign({ lineIds: [l.lineId], agentId: a.id }); setBusy(null); if (r.ok) { toast.success(`${r.data.lineRefs[0]} → ${r.data.agentName}`); router.refresh(); } else toast.error(r.error); }); };

  const columns: DataTableColumn<OpsRequestLine>[] = [
    { id: "no", accessorKey: "lineNo", header: "#", meta: { numeric: true, width: "3rem" }, cell: ({ row }) => <span className="font-mono text-xs">{String(row.original.lineNo).padStart(2, "0")}</span> },
    {
      id: "name", accessorKey: "name", header: O.col.name,
      cell: ({ row }) => <PrimaryCell title={row.original.name} className="max-w-[30ch]" sub={<span className="inline-flex items-center gap-2">{row.original.ref}{row.original.clientSku && <span>· {row.original.clientSku}</span>}</span>} />,
    },
    { id: "qty", accessorKey: "qty", header: O.col.qty, meta: { numeric: true }, cell: ({ row }) => (row.original.qty ? <Qty qty={row.original.qty} unit={row.original.unit} /> : "—") },
    {
      id: "input", accessorFn: (r) => r.links.length + r.imagesCount, header: "Input", enableSorting: false,
      cell: ({ row }) => (
        <span className="inline-flex items-center gap-2 text-xs text-ink-2">
          {row.original.links.map((l) => <a key={l.url} href={l.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} title={l.url} className="inline-flex items-center gap-0.5 font-mono hover:text-foreground hover:underline">{l.domain ?? l.url.replace(/^https?:\/\//, "").split("/")[0]}<ExternalLink className="size-3" />{l.not_durable && <AlertCircle className="size-3 text-warning" aria-label={O.notDurable} />}</a>)}
          {row.original.imagesCount > 0 && <span className="inline-flex items-center gap-1"><ImageIcon className="size-3.5" />{row.original.imagesCount}</span>}
          {!row.original.links.length && !row.original.imagesCount && <span className="text-faint">—</span>}
        </span>
      ),
    },
    { id: "state", accessorKey: "state", header: O.col.state, cell: ({ row }) => <span className="inline-flex items-center gap-1.5"><StateChip state={row.original.state} stale={row.original.stale} />{row.original.exception && <ExceptionChip exception={row.original.exception} />}</span> },
    { id: "milestone", accessorKey: "milestone", header: "Milestone", meta: { className: "hidden 2xl:table-cell" }, cell: ({ row }) => <MilestoneChip milestone={row.original.milestone} waitingOnClient={row.original.waitingParty === "client"} /> },
    { id: "waiting", accessorKey: "waitingReason", header: "Waiting on", cell: ({ row }) => { const r = row.original; if (r.waitingParty === "none") return <span className="text-faint">—</span>; return <span className={r.waitingParty === "agency" ? "text-foreground" : "text-ink-2"}><span className={cn("mr-1.5 inline-flex h-5 items-center rounded-md px-1.5 text-2xs font-semibold", r.waitingParty === "agency" ? "bg-info-wash text-info" : "bg-neutral-wash text-neutral")}>{r.waitingParty === "agency" ? "Us" : "Client"}</span>{nextStepLabel(r.waitingReason)}</span>; } },
    { id: "progress", accessorFn: (r) => r.sourcing.reached, header: "Reached · priced", meta: { numeric: true, className: "hidden 2xl:table-cell" }, cell: ({ row }) => <span>{row.original.sourcing.reached} · {row.original.sourcing.priced}</span> },
    { id: "last", accessorKey: "lastChangeAt", header: O.col.last, meta: { numeric: true }, cell: ({ row }) => <Age since={row.original.lastChangeAt} stale={row.original.stale} /> },
    { id: "agent", accessorKey: "agentName", header: O.col.agent, cell: ({ row }) => <AgentCell name={row.original.agentName} id={row.original.agentId} meId={me.id} /> },
    {
      id: "actions", header: "", enableSorting: false, meta: { numeric: true },
      cell: ({ row }) => {
        const l = row.original;
        const b = busy === l.lineId && pending;
        const canAssign = l.state === "submitted" || l.state === "in_review";
        return (
          <span className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            {!l.agentId && l.state === "submitted" && <Button size="sm" variant="outline" disabled={b} onClick={() => doClaim(l)} data-testid="claim">{b && <Loader2 className="animate-spin" />}{O.claim}</Button>}
            {canAssign && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild><Button size="sm" variant="ghost" disabled={b} data-testid="assign">{l.agentId ? O.reassign : O.assign}<ChevronDown /></Button></DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <DropdownMenuLabel>{O.assignTo}</DropdownMenuLabel><DropdownMenuSeparator />
                  {dto.agents.map((a) => <DropdownMenuItem key={a.id} onClick={() => doAssign(l, a)}>{a.name}</DropdownMenuItem>)}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </span>
        );
      },
    },
  ];

  const notes: TimelineEntry[] = dto.notes.map((n) => ({ id: n.id, kind: n.source === "whatsapp_log" ? "whatsapp" : n.kind === "question" ? "question" : "note", at: n.at, body: n.body, author: n.authorName, visibility: n.visibility, counterparty: n.counterparty, title: <span className="font-mono text-xs text-muted-foreground">{n.entityRef}</span> }));
  const activity: TimelineEntry[] = dto.activity.map((e) => ({
    id: e.id, kind: e.type === "whatsapp_logged" ? "whatsapp" : e.type === "document_uploaded" || e.type === "document_published" ? "document" : e.type === "state_changed" || e.type === "request_submitted" || e.type === "line_created" ? "milestone" : e.visibility === "internal" ? "system" : "note",
    at: e.at, title: <span>{eventText(e.type as never, e.payload)} <span className="font-mono text-xs text-muted-foreground">{e.entityRef}</span></span>, author: e.actorName, visibility: e.visibility,
  }));
  const states = dto.lines.reduce<{ state: OpsRequestLine["state"]; count: number }[]>((acc, l) => { const s = acc.find((x) => x.state === l.state); if (s) s.count++; else acc.push({ state: l.state, count: 1 }); return acc; }, []);
  const images = dto.documents.filter((d) => d.isImage);

  return (
    <>
      <PageHeader
        sticky
        crumbs={[{ href: "/ops/requests", label: "Requests" }, { label: <span className="font-mono">{dto.ref}</span> }]}
        eyebrow={<>{D.eyebrow} · <EyebrowLink href={`/ops/clients/${dto.orgId}`}>{dto.orgName}</EyebrowLink></>}
        title={<span className="font-mono">{dto.ref}</span>}
        titleSuffix={<span>{dto.lines.length} {dto.lines.length === 1 ? "line" : "lines"}</span>}
        meta={
          <>
            <UtilityBadge kind={dto.status === "draft" ? "draft" : dto.status === "closed" ? "version" : "catalog"} className="normal-case tracking-normal">{O.requests.status[dto.status]}</UtilityBadge>
            <SourceBadge source={dto.source} />
            <span className="h-4 w-px bg-border" aria-hidden />
            <StateRollup states={states} />
          </>
        }
        actions={
          <>
            <Button asChild variant="outline"><Link href={`/ops/clients/${dto.orgId}`}>Client page</Link></Button>
            {dto.acceptedLineIds.length > 0 && <Button asChild variant="default" title={D.confirmOrderHint(dto.acceptedLineIds.length)} data-testid="confirm-order-link"><Link href={`/ops/orders/new?req=${encodeURIComponent(dto.ref)}`}>{D.confirmOrder}</Link></Button>}
          </>
        }
      />

      <PageBand tone="page" pad="md" aria-label={D.lines}>
        <DataTable columns={columns} data={dto.lines} rowHref={(l) => l.href} isStale={(l) => l.stale} isNew={(l) => l.isNew && !l.agentId} density="compact" data-testid="request-lines-table" emptyState={<EmptyState title="No lines" className="py-8" />} />
      </PageBand>
      <div className="grid xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-6 py-6 xl:pr-6">

          {dto.note && (
            <section className="rounded-xl border border-border bg-card p-5" data-testid="client-note">
              <Eyebrow className="mb-1.5">{D.clientNote}</Eyebrow>
              <p className="whitespace-pre-wrap text-sm text-ink-2">{dto.note}</p>
            </section>
          )}

          {images.length > 0 && (
            <section className="rounded-xl border border-border bg-card p-5">
              <div className="mb-3 flex items-center justify-between"><Eyebrow>Client reference images</Eyebrow><span className="text-xs text-muted-foreground">client reference — never send to suppliers</span></div>
              <div className="flex flex-wrap gap-2">
                {images.map((d, i) => (
                  <a key={d.id} href={d.href} target="_blank" rel="noreferrer" className="group relative block overflow-hidden rounded-lg border border-border bg-section-alt" title={`${d.filename}${d.lineRef ? ` · ${d.lineRef}` : ""}`}>
                    <Image src={d.href} alt={d.filename} width={96} height={96} unoptimized className="size-24 object-cover" />
                    <span className="absolute inset-x-0 bottom-0 truncate bg-black/50 px-1.5 py-0.5 font-mono text-[10px] text-white">{d.lineRef ? `Line ${d.lineRef.slice(-2)}` : "Request"} · {i + 1}</span>
                  </a>
                ))}
              </div>
            </section>
          )}

          <Tabs defaultValue="notes">
            <TabsList>
              <TabsTrigger value="notes"><MessageCircle />{D.notes} <span className="font-mono text-xs text-muted-foreground">{dto.notes.length}</span></TabsTrigger>
              <TabsTrigger value="documents">{D.documents} <span className="font-mono text-xs text-muted-foreground">{dto.documents.length}</span></TabsTrigger>
              <TabsTrigger value="activity">{D.activity}</TabsTrigger>
            </TabsList>
            <TabsContent value="notes" className="pt-4"><div className="rounded-xl border border-border bg-card p-5"><Timeline entries={notes} showVisibility limit={15} emptyText={D.noNotes} /></div></TabsContent>
            <TabsContent value="documents" className="pt-4">
              {dto.documents.length ? <ul className="sheet">{dto.documents.map((d) => <DocumentRow key={d.id} name={d.filename} kind={d.kind} bytes={d.bytes} at={d.at} visibility={d.visibility} href={d.href} actions={d.lineRef ? <span className="font-mono text-xs text-muted-foreground">{d.lineRef}</span> : undefined} />)}</ul>
                : <div className="rounded-xl border border-border bg-card"><EmptyState title={D.noDocs} className="py-8" /></div>}
            </TabsContent>
            <TabsContent value="activity" className="pt-4"><div className="rounded-xl border border-border bg-card p-5"><Timeline entries={activity} showVisibility limit={15} emptyText={D.noActivity} /></div></TabsContent>
          </Tabs>
        </div>

        <aside className="band-alt -mb-12 py-6 xl:-mr-6 xl:border-t xl:border-l xl:border-hairline-strong xl:px-5 xl:[border-image:none]" aria-label={D.client}>
          <div className="xl:sticky-under-header">
          <Eyebrow className="mb-2">{D.client}</Eyebrow>
          <p className="text-base font-semibold text-foreground">{dto.orgName}</p>
          <div className="mt-3">
            <Fact label={D.facts.status}>{O.requests.status[dto.status]}</Fact>
            <Fact label={D.facts.source}>{O.source[dto.source]}</Fact>
            <Fact label={D.facts.submitted} mono>{dto.submittedAt ? <DateTime value={dto.submittedAt} /> : "—"}</Fact>
            <Fact label={D.facts.created} mono><DateTime value={dto.createdAt} /></Fact>
            <Fact label={D.facts.by}>{dto.createdByName ?? "—"}</Fact>
            <Fact label={D.facts.target} mono>{dto.targetDelivery ? <DateTime value={dto.targetDelivery} /> : "—"}</Fact>
            <Fact label={D.facts.destination}>{dto.destination ?? dto.orgCountry ?? "—"}</Fact>
            <Fact label={D.facts.incoterm} mono>{dto.incotermWanted ?? "—"}</Fact>
            <Fact label={D.facts.mode}>{labelOf("commercialMode", dto.commercialMode)}</Fact>
            <Fact label={D.facts.display}>{labelOf("pricingDisplay", dto.pricingDisplay)}</Fact>
          </div>
          <div className="mt-4 flex flex-col gap-2">
            <Button asChild variant="outline" size="sm" className="justify-start text-ink-2"><Link href={`/ops/requests?client=${dto.orgId}`}><Eye />All requests of {dto.orgName}</Link></Button>
          </div>
          </div>
        </aside>
      </div>
    </>
  );
}
