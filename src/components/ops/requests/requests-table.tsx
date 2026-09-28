"use client";
import * as React from "react";
import { useTranslations } from "next-intl";
import { Search, X, Clock } from "lucide-react";
import type { OpsRequestRow, Agent, ClientOrg } from "@/server/ops/requests";
import { LINE_STATES, type LineState } from "@/db/enums";
import { DataTable, PrimaryCell, type DataTableColumn } from "@/components/shared/data-table";
import { StateChip, UtilityBadge } from "@/components/shared/chips";
import { EmptyState } from "@/components/shared/empty-state";
import { Age } from "@/components/shared/formatters";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { SourceBadge } from "./queue-table";
import { O } from "./strings";

/** State chips with counts in lane order: `in_production 1 · sampling 1 · negotiating 1 …` (AC-QUEUE-03). */
export function StateRollup({ states }: { states: { state: LineState; count: number }[] }) {
  const sorted = [...states].sort((a, b) => LINE_STATES.indexOf(b.state) - LINE_STATES.indexOf(a.state));
  return (
    <span className="inline-flex max-w-[30rem] flex-wrap items-center gap-x-2 gap-y-1 py-1.5 whitespace-nowrap" data-testid="state-rollup">
      {sorted.map((s) => (
        <span key={s.state} className="inline-flex items-center gap-1" data-rollup-state={s.state} data-count={s.count}>
          <StateChip state={s.state} /><span className="font-mono text-xs text-ink-2">{s.count}</span>
        </span>
      ))}
    </span>
  );
}

/** F-14 requests list: ref · client · lines · states roll-up · agent(s) · updated · stale; filters client / state / agent / status / stale only. */
export function RequestsTable({ rows, agents, clients, me, initial }: { rows: OpsRequestRow[]; agents: Agent[]; clients: ClientOrg[]; me: { id: string }; initial: { client: string; state: string; agent: string; stale: boolean; status: string } }) {
  const ts = useTranslations("state");
  const [q, setQ] = React.useState("");
  const [client, setClient] = React.useState(initial.client);
  const [state, setState] = React.useState(initial.state);
  const [agent, setAgent] = React.useState(initial.agent);
  const [status, setStatus] = React.useState(initial.status);
  const [staleOnly, setStaleOnly] = React.useState(initial.stale);
  const [mine, setMine] = React.useState(false);

  const filtered = rows.filter((r) =>
    (!client || r.orgId === client) && (!state || r.states.some((s) => s.state === state)) && (!agent || (agent === "unassigned" ? r.unassignedCount > 0 : r.agentIds.includes(agent)))
    && (!status || r.status === status) && (!staleOnly || r.staleCount > 0) && (!mine || r.agentIds.includes(me.id)));
  const states = LINE_STATES.filter((s) => rows.some((r) => r.states.some((x) => x.state === s)));
  const active = !!(client || state || agent || status || staleOnly || mine || q);
  const reset = () => { setClient(""); setState(""); setAgent(""); setStatus(""); setStaleOnly(false); setMine(false); setQ(""); };

  const columns: DataTableColumn<OpsRequestRow>[] = [
    { id: "ref", accessorKey: "ref", header: O.col.ref, meta: { sticky: true }, cell: ({ row }) => <PrimaryCell title={<span className="font-mono text-xs">{row.original.ref}</span>} sub={row.original.firstLineName} /> },
    { id: "client", accessorKey: "orgName", header: O.col.client },
    { id: "status", accessorKey: "status", header: O.col.status, meta: { className: "hidden 2xl:table-cell" }, cell: ({ row }) => <UtilityBadge kind={row.original.status === "draft" ? "draft" : row.original.status === "closed" ? "version" : "catalog"} className="normal-case tracking-normal">{O.requests.status[row.original.status]}</UtilityBadge> },
    { id: "lines", accessorKey: "lineCount", header: O.col.lines, meta: { numeric: true, strong: true } },
    { id: "states", accessorFn: (r) => r.states.map((s) => `${s.state} ${s.count}`).join(" · "), header: O.col.states, enableSorting: false, meta: { className: "min-w-[18rem] whitespace-normal" }, cell: ({ row }) => <StateRollup states={row.original.states} /> },
    { id: "source", accessorKey: "source", header: O.col.source, cell: ({ row }) => <SourceBadge source={row.original.source} /> },
    { id: "agent", accessorFn: (r) => r.agentNames.join(", "), header: O.col.agent, cell: ({ row }) => (row.original.agentNames.length ? row.original.agentNames.join(", ") : <span className="text-faint">—</span>) },
    { id: "updated", accessorKey: "lastChangeAt", header: O.col.updated, meta: { numeric: true }, cell: ({ row }) => <Age since={row.original.lastChangeAt} stale={row.original.staleCount > 0} /> },
    { id: "stale", accessorKey: "staleCount", header: O.col.stale, meta: { numeric: true }, cell: ({ row }) => (row.original.staleCount ? <span className="inline-flex items-center gap-1 font-medium text-warning"><Clock className="size-3" />{row.original.staleCount}</span> : <span className="text-faint">—</span>) },
  ];

  const select = (value: string, onChange: (v: string) => void, label: string, options: { value: string; label: string }[], testId: string) => (
    <label className="inline-flex items-center gap-1.5 text-xs text-ink-2">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} data-testid={testId} className="h-8 rounded-lg border border-input bg-card px-2 text-sm text-foreground">
        <option value="">{O.all}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
  const toggle = (checked: boolean, onChange: (v: boolean) => void, label: string, testId: string) => (
    <label className={cn("inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 text-xs", checked ? "border-green-600 bg-green-50 text-green-700" : "border-input bg-card text-ink-2")}>
      <input type="checkbox" className="sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} data-testid={testId} />{label}
    </label>
  );

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center gap-3 rounded-t-xl border border-b-0 border-hairline-strong bg-section-alt px-4 py-3" data-testid="requests-toolbar">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={O.search} aria-label={O.search} className="h-8 w-56 pl-8" data-testid="requests-search" />
        </div>
        {select(client, setClient, O.col.client, clients.map((c) => ({ value: c.id, label: c.name })), "filter-client")}
        {select(state, setState, O.col.state, states.map((s) => ({ value: s, label: ts(s) })), "filter-state")}
        {select(agent, setAgent, O.col.agent, [{ value: "unassigned", label: O.unassigned }, ...agents.map((a) => ({ value: a.id, label: a.name }))], "filter-agent")}
        {select(status, setStatus, O.col.status, (["draft", "submitted", "active", "closed"] as const).map((s) => ({ value: s, label: O.requests.status[s] })), "filter-status")}
        {toggle(mine, setMine, O.requests.mine, "filter-mine")}
        {toggle(staleOnly, setStaleOnly, O.requests.staleOnly, "filter-stale")}
        {active && <Button variant="ghost" size="sm" onClick={reset}><X />{O.clearFilters}</Button>}
        <span className="ml-auto font-mono text-xs text-muted-foreground" data-testid="requests-count">{filtered.length} {filtered.length === 1 ? "request" : "requests"}</span>
      </div>
      <DataTable
        columns={columns} data={filtered} rowHref={(r) => r.href} isStale={(r) => r.staleCount > 0} density="compact" globalFilter={q}
        initialSorting={[{ id: "updated", desc: true }]} maxHeight="calc(100vh - 16rem)" className="rounded-t-none" data-testid="requests-table"
        emptyState={<EmptyState title={O.requests.empty} action={active ? <Button variant="outline" onClick={reset}>{O.clearFilters}</Button> : undefined} />}
      />
    </div>
  );
}
