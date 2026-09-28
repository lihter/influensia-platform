"use client";
import * as React from "react";
import { Search, Eye } from "lucide-react";
import type { SupplierRow } from "@/server/ops/suppliers";
import { SUPPLIER_TYPE_VERDICTS, SUPPLIER_GRADES, CONTACT_CHANNELS, type SupplierTypeVerdict, type SupplierGrade, type ContactChannel } from "@/db/enums";
import { DataTable, PrimaryCell, type DataTableColumn } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { Age, DateTime } from "@/components/shared/formatters";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { VerdictChip, GradeCircle, ChannelIcons, VERDICT_LABEL, CHANNEL_LABEL } from "./labels";

const ALL = "__all__";

/** DESIGN §6.11 list: toolbar on a section-alt band + dense table; row click → supplier page. */
export function SuppliersTable({ rows, cities }: { rows: SupplierRow[]; cities: string[] }) {
  const [q, setQ] = React.useState("");
  const [verdict, setVerdict] = React.useState<SupplierTypeVerdict | "">("");
  const [grade, setGrade] = React.useState<SupplierGrade | "">("");
  const [channel, setChannel] = React.useState<ContactChannel | "">("");
  const [city, setCity] = React.useState("");
  const [disclosedOnly, setDisclosedOnly] = React.useState(false);
  const [openOnly, setOpenOnly] = React.useState(false);
  const searchRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "/" && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) { e.preventDefault(); searchRef.current?.focus(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const data = React.useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (verdict && r.typeVerdict !== verdict) return false;
      if (grade && r.grade !== grade) return false;
      if (channel && !r.channels.includes(channel)) return false;
      if (city && r.city !== city) return false;
      if (disclosedOnly && !r.disclosed) return false;
      if (openOnly && r.openLines === 0) return false;
      if (needle && !`${r.ref} ${r.legalName} ${r.cnName ?? ""} ${r.city ?? ""} ${r.primaryContact ?? ""}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [rows, q, verdict, grade, channel, city, disclosedOnly, openOnly]);

  const active = [verdict && `Verdict: ${VERDICT_LABEL[verdict]}`, grade && `Grade ${grade}`, channel && CHANNEL_LABEL[channel], city, disclosedOnly && "Disclosed to a client", openOnly && "Has open lines"].filter(Boolean) as string[];
  const clear = () => { setQ(""); setVerdict(""); setGrade(""); setChannel(""); setCity(""); setDisclosedOnly(false); setOpenOnly(false); };

  const columns: DataTableColumn<SupplierRow>[] = [
    { id: "ref", accessorKey: "ref", header: "Ref", meta: { sticky: true, width: "6.5rem" }, cell: ({ row }) => <span className="font-mono text-xs">{row.original.ref}</span> },
    { id: "name", accessorKey: "legalName", header: "Legal name", cell: ({ row }) => <PrimaryCell title={row.original.legalName} sub={row.original.cnName ?? undefined} className="max-w-[36ch]" /> },
    { id: "verdict", accessorKey: "typeVerdict", header: "Type verdict", cell: ({ row }) => <VerdictChip verdict={row.original.typeVerdict} /> },
    { id: "grade", accessorKey: "grade", header: "Grade", meta: { className: "text-center" }, cell: ({ row }) => <GradeCircle grade={row.original.grade} /> },
    { id: "city", accessorKey: "city", header: "City / Province", cell: ({ row }) => (row.original.city ? <span>{row.original.city}{row.original.province && <span className="text-muted-foreground"> · {row.original.province}</span>}</span> : <span className="text-faint">—</span>) },
    { id: "channels", accessorKey: "channels", header: "Channels", enableSorting: false, cell: ({ row }) => <ChannelIcons channels={row.original.channels} /> },
    { id: "contact", accessorKey: "primaryContact", header: "Contact", cell: ({ row }) => row.original.primaryContact ?? <span className="text-faint">—</span> },
    { id: "participations", accessorKey: "participations", header: "Lines", meta: { numeric: true }, cell: ({ row }) => <span title={`${row.original.openLines} open`}>{row.original.participations}{row.original.openLines > 0 && <span className="text-muted-foreground"> · {row.original.openLines} open</span>}</span> },
    { id: "orders", accessorKey: "ordersCount", header: "Orders", meta: { numeric: true }, cell: ({ row }) => (row.original.ordersCount ? <span title={row.original.onTimeRate == null ? undefined : `on-time ${Math.round(row.original.onTimeRate * 100)} %`}>{row.original.ordersCount}</span> : <span className="text-faint">0</span>) },
    { id: "last", accessorKey: "lastUsedAt", header: "Last used", meta: { numeric: true }, cell: ({ row }) => (row.original.lastUsedAt ? <span title={row.original.lastUsedAt}><DateTime value={row.original.lastUsedAt} variant="short" /> <Age since={row.original.lastUsedAt} className="text-muted-foreground" /></span> : <span className="text-faint">—</span>) },
    { id: "disclosed", accessorKey: "disclosed", header: "Disclosed", enableSorting: false, cell: ({ row }) => (row.original.disclosed ? <Badge variant="danger" title={row.original.disclosedTo.join(", ")} data-testid="disclosed-badge"><Eye className="size-3" />{row.original.disclosedTo.join(", ")}</Badge> : null) },
  ];

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center gap-2 rounded-t-xl border border-b-0 border-border bg-section-alt px-4 py-3" data-testid="suppliers-toolbar">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, 中文, contact, handle  /" className="h-8 w-72 bg-card pl-8 text-[0.8125rem]" aria-label="Search suppliers" />
        </div>
        <Select value={verdict || ALL} onValueChange={(v) => setVerdict(v === ALL ? "" : (v as SupplierTypeVerdict))}>
          <SelectTrigger size="sm" className="bg-card" aria-label="Type verdict"><SelectValue placeholder="Verdict" /></SelectTrigger>
          <SelectContent><SelectItem value={ALL}>All verdicts</SelectItem>{SUPPLIER_TYPE_VERDICTS.map((v) => <SelectItem key={v} value={v}>{VERDICT_LABEL[v]}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={grade || ALL} onValueChange={(v) => setGrade(v === ALL ? "" : (v as SupplierGrade))}>
          <SelectTrigger size="sm" className="bg-card" aria-label="Grade"><SelectValue placeholder="Grade" /></SelectTrigger>
          <SelectContent><SelectItem value={ALL}>All grades</SelectItem>{SUPPLIER_GRADES.map((g) => <SelectItem key={g} value={g}>Grade {g}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={channel || ALL} onValueChange={(v) => setChannel(v === ALL ? "" : (v as ContactChannel))}>
          <SelectTrigger size="sm" className="bg-card" aria-label="Channel"><SelectValue placeholder="Channel" /></SelectTrigger>
          <SelectContent><SelectItem value={ALL}>All channels</SelectItem>{CONTACT_CHANNELS.map((c) => <SelectItem key={c} value={c}>{CHANNEL_LABEL[c]}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={city || ALL} onValueChange={(v) => setCity(v === ALL ? "" : v)}>
          <SelectTrigger size="sm" className="bg-card" aria-label="City"><SelectValue placeholder="City" /></SelectTrigger>
          <SelectContent><SelectItem value={ALL}>All cities</SelectItem>{cities.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
        </Select>
        <Button type="button" size="sm" variant={openOnly ? "secondary" : "ghost"} aria-pressed={openOnly} onClick={() => setOpenOnly((x) => !x)}>Has open lines</Button>
        <Button type="button" size="sm" variant={disclosedOnly ? "secondary" : "ghost"} aria-pressed={disclosedOnly} onClick={() => setDisclosedOnly((x) => !x)}>Disclosed to a client</Button>
        <span className="ml-auto font-mono text-xs text-muted-foreground" data-testid="suppliers-count">{data.length} of {rows.length}</span>
        {active.length > 0 && <Button type="button" size="sm" variant="ghost" onClick={clear}>Clear</Button>}
      </div>
      <DataTable
        columns={columns} data={data} rowHref={(r) => `/ops/suppliers/${r.ref}`} initialSorting={[{ id: "ref", desc: false }]} className="rounded-t-none" maxHeight="calc(100vh - 16rem)"
        data-testid="suppliers-table"
        emptyState={<EmptyState title="No suppliers match these filters" action={<Button variant="outline" onClick={clear}>Clear filters</Button>} className="py-8" />}
      />
    </div>
  );
}
