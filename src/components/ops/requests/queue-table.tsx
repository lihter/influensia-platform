"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, Search, ChevronDown, Link as LinkIcon, Image as ImageIcon, AlertCircle, X, UserRoundPen } from "lucide-react";
import type { QueueRow, Agent, ClientOrg } from "@/server/ops/requests";
import type { ActionResult } from "@/server/shared/http";
import { LINE_STATES } from "@/db/enums";
import { DataTable, PrimaryCell, type DataTableColumn } from "@/components/shared/data-table";
import { StateChip, ExceptionChip, UtilityBadge } from "@/components/shared/chips";
import { EmptyState } from "@/components/shared/empty-state";
import { Age, DateTime, Qty } from "@/components/shared/formatters";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { O } from "./strings";

type Claim = (input: { lineId: string }) => Promise<ActionResult<{ lineRef: string }>>;
type Assign = (input: { lineIds: string[]; agentId: string }) => Promise<ActionResult<{ lineRefs: string[]; agentName: string }>>;

const initials = (name: string) => name.split(/\s+/).map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();

export function SourceBadge({ source }: { source: QueueRow["source"] }) {
  const kind = source === "repeat" ? "repeat" : source === "catalog" ? "catalog" : source === "range" ? "range" : "version";
  return <UtilityBadge kind={kind} className="normal-case tracking-normal">{O.source[source]}</UtilityBadge>;
}

export function AgentCell({ name, id, meId }: { name: string | null; id: string | null; meId: string }) {
  if (!name) return <span className="text-faint">—</span>;
  return (
    <span className="inline-flex items-center gap-2">
      <Avatar className={cn("size-6", id === meId && "ring-2 ring-green-600")}><AvatarFallback className="bg-section-alt text-[10px] font-semibold text-ink-2">{initials(name)}</AvatarFallback></Avatar>
      <span>{name}</span>
    </span>
  );
}

/**
 * DESIGN §6.7 — dense queue table: toolbar (search, client / state / agent filters, scope tabs), sticky ref column,
 * links (icons + "may expire" flag), image count, source badge, Claim / Assign ▾ per row, checkbox bulk assign.
 */
export function QueueTable({ rows, agents, clients, me, scope, initial, claim, assign }: {
  rows: QueueRow[]; agents: Agent[]; clients: ClientOrg[]; me: { id: string; name: string }; scope: "queue" | "unassigned" | "waiting";
  initial: { client: string; state: string; agent: string }; claim: Claim; assign: Assign;
}) {
  const ts = useTranslations("state");
  const router = useRouter();
  const [q, setQ] = React.useState("");
  const [client, setClient] = React.useState(initial.client);
  const [state, setState] = React.useState(initial.state);
  const [agent, setAgent] = React.useState(initial.agent);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [busy, setBusy] = React.useState<string | null>(null);
  const [pending, start] = React.useTransition();

  const filtered = rows.filter((r) => (!client || r.orgId === client) && (!state || r.state === state) && (!agent || (agent === "unassigned" ? !r.agentId : r.agentId === agent)));
  const states = LINE_STATES.filter((s) => rows.some((r) => r.state === s));
  const allSelected = filtered.length > 0 && filtered.every((r) => selected.has(r.lineId));

  const doClaim = (row: QueueRow) => { setBusy(row.lineId); start(async () => { const r = await claim({ lineId: row.lineId }); setBusy(null); if (r.ok) { toast.success(`${O.assignedToYou} · ${r.data.lineRef}`); router.refresh(); } else toast.error(r.error); }); };
  const doAssign = (lineIds: string[], a: Agent) => { setBusy(lineIds[0]); start(async () => { const r = await assign({ lineIds, agentId: a.id }); setBusy(null); if (r.ok) { toast.success(`${r.data.lineRefs.length === 1 ? r.data.lineRefs[0] : `${r.data.lineRefs.length} lines`} → ${r.data.agentName}`); setSelected(new Set()); router.refresh(); } else toast.error(r.error); }); };

  const assignMenu = (lineIds: string[], trigger: React.ReactNode) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel>{O.assignTo}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {agents.map((a) => <DropdownMenuItem key={a.id} onClick={(e) => { e.stopPropagation(); doAssign(lineIds, a); }} data-testid={`assign-${a.name.split(" ")[0].toLowerCase()}`}><Avatar className="size-5"><AvatarFallback className="bg-section-alt text-[9px] font-semibold text-ink-2">{initials(a.name)}</AvatarFallback></Avatar>{a.name}{a.id === me.id && <span className="ml-auto text-xs text-muted-foreground">you</span>}</DropdownMenuItem>)}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const columns: DataTableColumn<QueueRow>[] = [
    {
      id: "select", header: () => <input type="checkbox" aria-label="Select all" className="size-4 accent-green-600" checked={allSelected} onChange={(e) => setSelected(e.target.checked ? new Set(filtered.map((r) => r.lineId)) : new Set())} />,
      enableSorting: false, meta: { width: "2.5rem" },
      cell: ({ row }) => <input type="checkbox" aria-label={`Select ${row.original.ref}`} className="size-4 accent-green-600" checked={selected.has(row.original.lineId)} onClick={(e) => e.stopPropagation()} onChange={(e) => setSelected((s) => { const n = new Set(s); if (e.target.checked) n.add(row.original.lineId); else n.delete(row.original.lineId); return n; })} data-testid="select-row" />,
    },
    { id: "ref", accessorKey: "ref", header: O.col.ref, cell: ({ row }) => <PrimaryCell title={<span className="font-mono text-xs">{row.original.ref}</span>} sub={<span className="font-sans">{row.original.orgName}</span>} /> },
    { id: "client", accessorKey: "orgName", header: O.col.client, meta: { className: "hidden 2xl:table-cell" } },
    { id: "name", accessorKey: "name", header: O.col.name, cell: ({ row }) => <PrimaryCell title={row.original.name} className="max-w-[28ch]" /> },
    { id: "qty", accessorKey: "qty", header: O.col.qty, meta: { numeric: true }, cell: ({ row }) => (row.original.qty ? <Qty qty={row.original.qty} unit={row.original.unit} /> : "—") },
    {
      id: "links", accessorFn: (r) => r.links.length + r.imagesCount, header: O.col.links, enableSorting: false,
      cell: ({ row }) => (
        <span className="inline-flex items-center gap-1.5 text-xs text-ink-2" data-testid="links-cell">
          {row.original.links.map((l) => <a key={l.url} href={l.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} title={l.url} className="text-ink-2 hover:text-foreground"><LinkIcon className="size-4" /></a>)}
          {row.original.links.length > 0 && <span className="font-mono">{row.original.links.length}</span>}
          {row.original.notDurable > 0 && <span title={O.notDurable} className="text-warning"><AlertCircle className="size-3.5" /></span>}
          {row.original.imagesCount > 0 && <span className="inline-flex items-center gap-1"><ImageIcon className="size-4" /><span className="font-mono">{row.original.imagesCount}</span></span>}
          {row.original.links.length === 0 && row.original.imagesCount === 0 && <span className="text-faint">—</span>}
        </span>
      ),
    },
    { id: "source", accessorKey: "source", header: O.col.source, cell: ({ row }) => <SourceBadge source={row.original.source} /> },
    { id: "state", accessorKey: "state", header: O.col.state, cell: ({ row }) => <span className="inline-flex items-center gap-1.5"><StateChip state={row.original.state} stale={row.original.stale} />{row.original.exception && <ExceptionChip exception={row.original.exception} />}</span> },
    { id: "submitted", accessorKey: "submittedAt", header: O.col.submitted, meta: { numeric: true }, cell: ({ row }) => <span title={`last change ${row.original.daysSinceChange} d ago`}><DateTime value={row.original.submittedAt} variant="short" />{row.original.stale && <Age since={row.original.lastChangeAt} stale className="ml-1" />}</span> },
    { id: "agent", accessorKey: "agentName", header: O.col.agent, cell: ({ row }) => <AgentCell name={row.original.agentName} id={row.original.agentId} meId={me.id} /> },
    {
      id: "actions", header: "", enableSorting: false, meta: { numeric: true },
      cell: ({ row }) => {
        const r = row.original;
        const b = busy === r.lineId && pending;
        return (
          <span className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            {!r.agentId && <Button size="sm" variant="outline" disabled={b} onClick={() => doClaim(r)} data-testid="claim">{b && <Loader2 className="animate-spin" />}{O.claim}</Button>}
            {assignMenu([r.lineId], r.agentId
              ? <Button size="icon-sm" variant="ghost" disabled={b} data-testid="assign" aria-label={O.reassign} title={O.reassign}><UserRoundPen /></Button>
              : <Button size="sm" variant="outline" disabled={b} data-testid="assign" aria-label={O.assign} title={O.assign}><ChevronDown /></Button>)}
          </span>
        );
      },
    },
  ];

  const scopeLink = (s: typeof scope, label: string) => (
    <Link href={s === "queue" ? "/ops/queue" : `/ops/queue?scope=${s}`} role="tab" aria-selected={scope === s} data-testid={`scope-${s}`} className={cn("flex h-full items-center rounded-md px-3 text-sm font-medium", scope === s ? "bg-card text-foreground shadow-sm" : "text-ink-2")}>{label}</Link>
  );
  const select = (value: string, onChange: (v: string) => void, label: string, options: { value: string; label: string }[], testId: string) => (
    <label className="inline-flex items-center gap-1.5 text-xs text-ink-2">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} data-testid={testId} className="h-8 rounded-lg border border-input bg-card px-2 text-sm text-foreground">
        <option value="">{O.all}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center gap-3 rounded-t-xl border border-b-0 border-hairline-strong bg-section-alt px-4 py-3" data-testid="queue-toolbar">
        <div className="inline-flex h-9 items-center rounded-lg bg-muted p-[3px]" role="tablist" aria-label="Scope">
          {scopeLink("queue", O.scope.queue)}{scopeLink("unassigned", O.scope.unassigned)}{scopeLink("waiting", O.scope.waiting)}
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={O.search} aria-label={O.search} className="h-8 w-56 pl-8" data-testid="queue-search" />
        </div>
        {select(client, setClient, O.col.client, clients.map((c) => ({ value: c.id, label: c.name })), "filter-client")}
        {select(state, setState, O.col.state, states.map((s) => ({ value: s, label: ts(s) })), "filter-state")}
        {select(agent, setAgent, O.col.agent, [{ value: "unassigned", label: O.unassigned }, ...agents.map((a) => ({ value: a.id, label: a.name }))], "filter-agent")}
        {(client || state || agent || q) && <Button variant="ghost" size="sm" onClick={() => { setClient(""); setState(""); setAgent(""); setQ(""); router.replace("/ops/queue" + (scope === "queue" ? "" : `?scope=${scope}`)); }}><X />{O.clearFilters}</Button>}
        <span className="ml-auto font-mono text-xs text-muted-foreground" data-testid="queue-count">{filtered.length} {filtered.length === 1 ? "line" : "lines"}</span>
      </div>
      <DataTable
        columns={columns} data={filtered} rowHref={(r) => r.href} isNew={(r) => r.isNew && !r.agentId} isStale={(r) => r.stale} isSelected={(r) => selected.has(r.lineId)} density="compact" globalFilter={q}
        initialSorting={[{ id: "submitted", desc: false }]} maxHeight="calc(100vh - 16rem)" className="rounded-t-none" data-testid="queue-table"
        emptyState={<EmptyState title={O.empty} body={O.emptyHint} action={client || state || agent || q ? <Button variant="outline" onClick={() => { setClient(""); setState(""); setAgent(""); setQ(""); }}>{O.clearFilters}</Button> : undefined} />}
      />
      {selected.size > 0 && (
        <div className="fixed inset-x-4 bottom-4 z-40 mx-auto flex max-w-xl items-center justify-between gap-3 rounded-xl bg-inverse px-4 py-3 text-sm text-white shadow-sheet" data-testid="bulk-bar">
          <span><span className="font-mono">{selected.size}</span> selected</span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" className="text-white hover:bg-white/10 hover:text-white" onClick={() => setSelected(new Set())}>Clear</Button>
            {assignMenu([...selected], <Button variant="action" size="sm" data-testid="bulk-assign">{O.assign}<ChevronDown /></Button>)}
          </div>
        </div>
      )}
    </div>
  );
}
