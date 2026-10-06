"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Eye, Star, Pencil, Trash2, Upload, Plus, MoreHorizontal, Download } from "lucide-react";
import type { SupplierDetail, SupplierContact, SupplierParticipation } from "@/server/ops/suppliers";
import type { ActionResult } from "@/server/shared/http";
import type { ContactFormInput, SupplierFormInput } from "@/app/(ops)/ops/suppliers/actions";
import type { LineState } from "@/db/enums";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table";
import { MediaCell } from "@/components/shared/media";
import { ParticipationChip, StateChip, VisibilityBadge } from "@/components/shared/chips";
import { FactoryLabel } from "@/components/shared/factory-label";
import { EmptyState } from "@/components/shared/empty-state";
import { KpiTile } from "@/components/shared/kpi-tile";
import { DateTime, Age, UnitPrice, Money } from "@/components/shared/formatters";
import { formatBytes } from "@/components/shared/document-row";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { VerdictChip, GradeCircle, ChannelBadge, SOURCE_LABEL } from "./labels";
import { SupplierForm, type SupplierFormValues } from "./supplier-form";
import { ContactForm } from "./contact-form";
import { DocumentUploadForm } from "./document-upload-form";

type Actions = {
  update: (i: { id: string } & SupplierFormInput) => Promise<ActionResult<{ ref: string }>>;
  addContact: (i: { supplierId: string; supplierRef: string } & ContactFormInput) => Promise<ActionResult<{ id: string }>>;
  updateContact: (i: { contactId: string; supplierRef: string } & ContactFormInput) => Promise<ActionResult<undefined>>;
  removeContact: (i: { contactId: string; supplierRef: string }) => Promise<ActionResult<undefined>>;
  uploadDocument: (fd: FormData) => Promise<ActionResult<{ documentId: string }>>;
  remove: (i: { id: string }) => Promise<ActionResult<undefined>>;
};

function Def({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[10rem_1fr] gap-4 px-5 py-3 text-sm">
      <dt className="eyebrow self-center">{label}</dt>
      <dd className={mono ? "font-mono text-[13px]" : ""}>{children ?? <span className="text-faint">—</span>}</dd>
    </div>
  );
}

/** DESIGN §6.11 supplier page: sticky header, disclosed band, tabs + rail. */
export function SupplierPage({ s, isAdmin, actions }: { s: SupplierDetail; isAdmin: boolean; actions: Actions }) {
  const router = useRouter();
  const [editOpen, setEditOpen] = React.useState(false);
  const [contactOpen, setContactOpen] = React.useState(false);
  const [editingContact, setEditingContact] = React.useState<SupplierContact | null>(null);
  const [tab, setTab] = React.useState("profile");

  const lineHref = (p: SupplierParticipation) => `/ops/lines/${p.lineRef}?tab=sourcing`;
  const partColumns: DataTableColumn<SupplierParticipation>[] = [
    { id: "line", accessorKey: "lineRef", header: "Request line", meta: { sticky: true }, cell: ({ row }) => <MediaCell image={row.original.image} title={row.original.lineName} sub={row.original.lineRef} /> },
    { id: "client", accessorKey: "orgName", header: "Client" },
    { id: "lineState", accessorKey: "lineState", header: "Line", cell: ({ row }) => <StateChip state={row.original.lineState as LineState} /> },
    { id: "status", accessorKey: "status", header: "Status", cell: ({ row }) => <span className="inline-flex items-center gap-1.5"><ParticipationChip status={row.original.status} />{row.original.reason && <span className="max-w-[24ch] truncate text-xs text-muted-foreground" title={row.original.reason}>{row.original.reason}</span>}</span> },
    { id: "quote", accessorFn: (r) => r.latestQuote?.usdMinorE2 ?? r.latestQuote?.unitPriceMinorE2 ?? null, header: "Latest quote", meta: { numeric: true, strong: true }, cell: ({ row }) => {
      const q = row.original.latestQuote;
      if (!q) return <span className="text-faint">—</span>;
      const e2 = q.usdMinorE2 ?? q.unitPriceMinorE2;
      return e2 == null ? <span className="text-faint">no price</span> : <span title={`v${q.version} · ${q.incoterm ?? "?"}${q.incotermUncertain ? " (uncertain)" : ""} ${q.port ?? ""} · MOQ ${q.moq ?? "?"} · lead ${q.leadDays ?? "?"} d · valid ${q.validUntil ?? "?"}`}><UnitPrice minorE2={e2} currency={q.usdMinorE2 != null ? "USD" : q.currency} unit={q.unit} decimals={4} />{q.incoterm && <span className="ml-1 text-xs font-normal text-muted-foreground">{q.incoterm}{q.incotermUncertain ? "?" : ""}</span>}</span>;
    } },
    { id: "quotes", accessorKey: "quotesCount", header: "Quotes", meta: { numeric: true } },
    { id: "contact", accessorKey: "contactName", header: "Via", cell: ({ row }) => row.original.contactName ?? <span className="text-faint">—</span> },
    { id: "last", accessorFn: (r) => r.lastContactAt ?? r.firstContactAt ?? "", header: "Last contact", meta: { numeric: true }, cell: ({ row }) => { const d = row.original.lastContactAt ?? row.original.firstContactAt; return d ? <span><DateTime value={d} variant="short" /> <Age since={d} className="text-muted-foreground" /></span> : <span className="text-faint">—</span>; } },
  ];

  const initialForm = React.useMemo<Partial<SupplierFormValues>>(() => ({
    legalName: s.legalName, cnName: s.cnName ?? "", typeVerdict: s.typeVerdict, verdictSource: s.verdictSource ?? "", grade: s.grade ?? "", uscc: s.uscc ?? "", registeredAt: s.registeredAt ?? "", capital: s.capital ?? "",
    city: s.city ?? "", province: s.province ?? "", country: s.country, ports: s.ports, website: s.website ?? "", notes: s.notes ?? "",
  }), [s]);
  const contactInitial = React.useMemo(() => (editingContact ? { name: editingContact.name ?? "", channel: editingContact.channel, handle: editingContact.handle ?? "", phone: editingContact.phone ?? "", isPrimary: editingContact.isPrimary } : undefined), [editingContact]);

  return (
    <>
      <PageHeader
        sticky
        crumbs={[{ href: "/ops/suppliers", label: "Suppliers" }, { label: <span className="font-mono">{s.ref}</span> }]}
        eyebrow={[s.ref, s.city, s.province].filter(Boolean).join(" · ")}
        title={s.legalName}
        titleSuffix={s.cnName || s.uscc ? <>{s.cnName}{s.cnName && s.uscc ? " · " : ""}{s.uscc}</> : undefined}
        meta={
          <>
            <VerdictChip verdict={s.typeVerdict} />
            <GradeCircle grade={s.grade} />
            {s.verdictSource && <span className="text-xs text-muted-foreground">{SOURCE_LABEL[s.verdictSource]}{s.verdictCheckedAt && <> · <DateTime value={s.verdictCheckedAt} variant="short" /></>}</span>}
            {s.ranges.filter((r) => r.label).map((r) => <FactoryLabel key={r.id} label={r.label!} disclosed={false} />)}
          </>
        }
        actions={
          <>
            <Button variant="outline" onClick={() => setEditOpen(true)} data-testid="edit-supplier"><Pencil data-icon="inline-start" />Edit</Button>
            <Button variant="outline" onClick={() => { setEditingContact(null); setContactOpen(true); }} data-testid="add-contact"><Plus data-icon="inline-start" />Add contact</Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label="More"><MoreHorizontal /></Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setTab("documents")}><Upload />Upload price list</DropdownMenuItem>
                {isAdmin && (
                  <DropdownMenuItem variant="destructive" onSelect={async () => { if (!confirm(`Delete ${s.ref} ${s.legalName}? Blocked while selected on a line.`)) return; const r = await actions.remove({ id: s.id }); if (r.ok) { toast.success("Supplier deleted"); router.push("/ops/suppliers"); } else toast.error(r.error === "E_FORBIDDEN" ? "Blocked — this supplier is selected on a line" : r.error); }}><Trash2 />Delete supplier</DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />
      <SupplierForm mode="edit" supplierId={s.id} isAdmin={isAdmin} initial={initialForm} open={editOpen} onOpenChange={setEditOpen} onUpdate={actions.update} />
      <ContactForm supplierId={s.id} supplierRef={s.ref} contactId={editingContact?.id} initial={contactInitial} open={contactOpen} onOpenChange={setContactOpen} onAdd={actions.addContact} onUpdate={actions.updateContact} />

      {s.disclosedTo.length > 0 && (
        <div className="mb-6 flex items-center gap-2 rounded-lg border border-warning-border bg-warning-wash px-4 py-3 text-sm text-warning" data-testid="disclosed-band">
          <Eye className="size-4 shrink-0" />
          <span><strong className="font-semibold">Disclosed to {s.disclosedTo.map((d) => d.name).join(", ")}</strong> — this supplier&apos;s name has appeared on their shipping or bank documents. Do not treat it as anonymous for that client.</span>
        </div>
      )}

      <div className="grid xl:grid-cols-[minmax(0,1fr)_22rem]">
        <Tabs value={tab} onValueChange={setTab} className="min-w-0 py-6 xl:pr-6">
          <TabsList>
            <TabsTrigger value="profile">Profile</TabsTrigger>
            <TabsTrigger value="contacts">Contacts <span className="font-mono text-xs text-muted-foreground">{s.contacts.length}</span></TabsTrigger>
            <TabsTrigger value="participations">Participations <span className="font-mono text-xs text-muted-foreground">{s.participations.length}</span></TabsTrigger>
            <TabsTrigger value="documents">Price lists &amp; catalogues <span className="font-mono text-xs text-muted-foreground">{s.documents.length}</span></TabsTrigger>
            <TabsTrigger value="performance">Performance</TabsTrigger>
          </TabsList>

          <TabsContent value="profile" className="pt-4">
            <dl className="sheet divide-y divide-hairline-faint" data-testid="profile">
              <Def label="Legal name">{s.legalName}</Def>
              <Def label="中文名">{s.cnName}</Def>
              <Def label="Type verdict"><span className="inline-flex items-center gap-2"><VerdictChip verdict={s.typeVerdict} />{s.verdictSource && <span className="text-xs text-muted-foreground">via {SOURCE_LABEL[s.verdictSource]}{s.verdictCheckedAt && <> · checked <DateTime value={s.verdictCheckedAt} /></>}</span>}</span></Def>
              <Def label="Grade"><GradeCircle grade={s.grade} /></Def>
              <Def label="USCC" mono>{s.uscc}</Def>
              <Def label="Registered" mono>{s.registeredAt ? <DateTime value={s.registeredAt} /> : null}</Def>
              <Def label="Capital" mono>{s.capital}</Def>
              <Def label="Location">{[s.city, s.province, s.country].filter(Boolean).join(" · ") || null}</Def>
              <Def label="Ports">{s.ports.length ? <span className="inline-flex flex-wrap gap-1">{s.ports.map((p) => <Badge key={p} variant="neutral" className="normal-case tracking-normal">{p}</Badge>)}</span> : null}</Def>
              <Def label="Website">{s.website ? <a href={s.website} target="_blank" rel="noreferrer" className="link">{s.website}</a> : null}</Def>
              <Def label="Disclosed to">{s.disclosedTo.length ? <span className="inline-flex flex-wrap gap-1">{s.disclosedTo.map((d) => <Badge key={d.orgId} variant="danger"><Eye className="size-3" />{d.name}</Badge>)}</span> : <span className="text-muted-foreground">nobody — anonymous to every client</span>}</Def>
              <Def label="Notes"><span className="whitespace-pre-wrap">{s.notes}</span></Def>
              <Def label="Created" mono><DateTime value={s.createdAt} />{s.createdByName && <span className="text-muted-foreground"> · {s.createdByName}</span>}</Def>
            </dl>
          </TabsContent>

          <TabsContent value="contacts" className="pt-4">
            {s.contacts.length === 0 ? (
              <div className="rounded-xl border border-border bg-card"><EmptyState title="No contacts yet" body="Add the person you talk to and the channel you use." action={<Button onClick={() => { setEditingContact(null); setContactOpen(true); }}><Plus data-icon="inline-start" />Add contact</Button>} /></div>
            ) : (
              <ul className="sheet" data-testid="contacts">
                {s.contacts.map((c) => (
                  <li key={c.id} className="sheet-row flex items-center gap-3" data-testid="contact-row" data-channel={c.channel}>
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 text-sm font-medium">{c.name ?? <span className="text-muted-foreground">Name not recorded</span>}{c.isPrimary && <Star className="size-3.5 fill-green-600 text-green-600" aria-label="primary" />}</p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><ChannelBadge channel={c.channel} />{c.handle && <span className="font-mono text-foreground">{c.handle}</span>}{c.phone && <span className="font-mono">{c.phone}</span>}</p>
                    </div>
                    <Button variant="ghost" size="icon-sm" aria-label="Edit contact" onClick={() => { setEditingContact(c); setContactOpen(true); }}><Pencil /></Button>
                    <Button variant="ghost" size="icon-sm" aria-label="Remove contact" onClick={async () => { if (!confirm("Remove this contact?")) return; const r = await actions.removeContact({ contactId: c.id, supplierRef: s.ref }); if (r.ok) { toast.success("Contact removed"); router.refresh(); } else toast.error(r.error); }}><Trash2 /></Button>
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>

          <TabsContent value="participations" className="pt-4">
            <DataTable columns={partColumns} data={s.participations} rowHref={lineHref} density="compact" initialSorting={[{ id: "line", desc: true }]} data-testid="participations"
              emptyState={<EmptyState title="Not on any line yet" body="Add this supplier from a line's sourcing board." className="py-8" />} />
          </TabsContent>

          <TabsContent value="documents" className="pt-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm text-ink-2">Internal documents. Price lists and catalogues are never published to a client.</p>
              <DocumentUploadForm supplierId={s.id} supplierRef={s.ref} action={actions.uploadDocument} trigger={<Button variant="outline" size="sm" data-testid="upload-doc"><Upload data-icon="inline-start" />Upload</Button>} />
            </div>
            {s.documents.length === 0 ? (
              <div className="rounded-xl border border-border bg-card"><EmptyState title="No price lists or catalogues" body="Upload what the factory sent so the next quote starts from their list." /></div>
            ) : (
              <ul className="sheet" data-testid="supplier-documents">
                {s.documents.map((d) => (
                  <li key={d.id} className="sheet-row flex items-center gap-3" data-testid="document-row" data-kind={d.kind}>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium" title={d.filename}>{d.filename}</p>
                      <p className="text-xs text-muted-foreground">{d.kind === "price_list" ? "Price list" : "Catalogue"} · <span className="font-mono">{formatBytes(d.bytes)}</span>{d.receivedAt && <> · received <DateTime value={d.receivedAt} variant="short" /></>}{d.validUntil && <> · valid until <DateTime value={d.validUntil} variant="short" /></>}{d.currency && <> · {d.currency}</>}{d.notes && <> · {d.notes}</>}</p>
                    </div>
                    <VisibilityBadge visibility="internal" />
                    {d.storageKey && <Button asChild variant="ghost" size="icon-sm" aria-label="Download"><a href={`/api/files/${d.storageKey}?dl=1&filename=${encodeURIComponent(d.filename)}`}><Download /></a></Button>}
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>

          <TabsContent value="performance" className="pt-4">
            <div className="grid grid-cols-2 gap-4 xl:grid-cols-4" data-testid="performance">
              <KpiTile label="Orders" value={s.performance.ordersCount} meta={s.performance.lastOrderAt ? `last ${new Date(s.performance.lastOrderAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}` : "no orders yet"} tone="neutral" />
              <KpiTile label="On-time" value={s.performance.onTimeRate == null ? "—" : `${Math.round(s.performance.onTimeRate * 100)} %`} meta="ex-works vs promised" tone="neutral" />
              <KpiTile label="Defect rate" value={s.performance.defectRate == null ? "—" : `${(s.performance.defectRate * 100).toFixed(1)} %`} meta="from QC reports" tone="neutral" />
              <KpiTile label="Quote accuracy" value={s.performance.quoteAccuracy == null ? "—" : `${Math.round(s.performance.quoteAccuracy * 100)} %`} meta="quote vs invoice" tone="neutral" />
            </div>
            <h3 className="mt-6 mb-2 text-base font-semibold">Purchase orders <span className="font-mono text-sm font-normal text-muted-foreground">{s.purchaseOrders.length}</span></h3>
            {s.purchaseOrders.length === 0 ? <p className="text-sm text-muted-foreground">No purchase orders with this factory yet.</p> : (
              <ul className="sheet">
                {s.purchaseOrders.map((po) => (
                  <li key={po.id} className="sheet-row flex items-center gap-3 text-sm">
                    <span className="font-mono text-xs">{po.ref}</span>
                    <Link href={`/ops/orders/${po.orderRef}`} className="link font-mono text-xs">{po.orderRef}</Link>
                    <span className="text-ink-2">{po.orgName}</span>
                    <Badge variant="neutral">{po.status.replace(/_/g, " ")}</Badge>
                    <span className="ml-auto"><Money minor={po.factoryTotalMinor} currency={po.currency} strong /></span>
                    {po.issuedAt && <DateTime value={po.issuedAt} variant="short" className="text-muted-foreground" />}
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>
        </Tabs>

        <aside className="band-alt -mb-12 py-6 xl:-mr-6 xl:min-h-[calc(100dvh-10rem)] xl:border-l xl:border-hairline-strong xl:px-5 xl:[border-image-source:none]" data-testid="supplier-rail"><div className="xl:sticky-under-header">
          <p className="eyebrow mb-3">Shown to clients as</p>
          {s.ranges.length === 0 ? (
            <p className="text-sm text-muted-foreground">No factory range published yet. Clients only ever see a “Factory F-nnnn” label.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {s.ranges.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm">
                  <div className="flex flex-col gap-1">
                    {r.label ? <FactoryLabel label={r.label} disclosed={s.disclosedTo.some((d) => d.name === r.orgName)} /> : <Badge variant="neutral">draft · no label yet</Badge>}
                    <span className="text-xs text-muted-foreground">{r.orgName} · {r.itemCount} items{r.publishedAt ? <> · published <DateTime value={r.publishedAt} variant="short" /></> : " · not published"}</span>
                  </div>
                  <Link href={`/ops/factory-ranges/${r.ref}`} className="link font-mono text-xs">{r.ref}</Link>
                </li>
              ))}
            </ul>
          )}
          <p className="eyebrow mt-6 mb-3">Quick stats</p>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Lines</dt><dd className="font-mono text-right">{s.participations.length}</dd>
            <dt className="text-muted-foreground">Selected</dt><dd className="font-mono text-right">{s.participations.filter((p) => p.status === "selected").length}</dd>
            <dt className="text-muted-foreground">Quotes</dt><dd className="font-mono text-right">{s.participations.reduce((a, p) => a + p.quotesCount, 0)}</dd>
            <dt className="text-muted-foreground">Contacts</dt><dd className="font-mono text-right">{s.contacts.length}</dd>
            <dt className="text-muted-foreground">Updated</dt><dd className="text-right"><DateTime value={s.updatedAt} variant="short" /></dd>
          </dl>
          <Button asChild variant="outline" size="sm" className="mt-6 w-full"><Link href={`/ops/factory-ranges/new?supplier=${s.id}`}>New factory range</Link></Button>
        </div></aside>
      </div>
    </>
  );
}
