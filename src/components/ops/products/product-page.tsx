"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, X, Upload, EyeOff, Trash2, Sparkles, Loader2, AlertCircle } from "lucide-react";
import type { ProductDetail, ProductImage } from "@/server/ops/products";
import type { ActionResult } from "@/server/shared/http";
import type { ProductFormInput, ReferenceFormInput } from "@/app/(ops)/ops/products/actions";
import type { ClientCatalogDto } from "@/server/client/dto";
import { PRODUCT_CATEGORIES, IMAGE_KINDS, type ImageKind } from "@/db/enums";
import { formatDate } from "@/server/shared/dates";
import { PageHeader } from "@/components/shared/page-header";
import { label, specKeyLabel, specValueLabel } from "@/lib/labels";
import { DataTable, PrimaryCell, type DataTableColumn } from "@/components/shared/data-table";
import { StateChip, UtilityBadge, VisibilityBadge } from "@/components/shared/chips";
import { EmptyState } from "@/components/shared/empty-state";
import { DateTime, Qty, UnitPrice } from "@/components/shared/formatters";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { FieldRow } from "@/components/ops/suppliers/supplier-form";
import { CatalogCard } from "@/components/app/catalog/catalog-card";
import { VisibilityChip, ValidUntil } from "./products-table";
import { cn } from "@/lib/utils";

type Actions = {
  update: (i: { id: string } & ProductFormInput & ReferenceFormInput) => Promise<ActionResult<{ ref: string }>>;
  publish: (i: { id: string; withoutImage?: boolean } & ReferenceFormInput) => Promise<ActionResult<{ ref: string }>>;
  unpublish: (i: { id: string }) => Promise<ActionResult<{ ref: string }>>;
  uploadImage: (fd: FormData) => Promise<ActionResult<{ imageId: string }>>;
  approveImage: (i: { imageId: string; productRef: string }) => Promise<ActionResult<{ imageId: string }>>;
  removeImage: (i: { imageId: string; productRef: string }) => Promise<ActionResult<undefined>>;
};

const INCOTERMS = ["FOB", "EXW", "CIF", "DDP", "DAP", "FCA"];
const NONE = "__none__";
const e2ToText = (e2: number | null) => (e2 == null ? "" : (e2 / 10000).toFixed(4).replace(/\.?0+$/, "").replace(/^(\d+)$/, "$1.00"));
const KIND_LABEL: Record<ImageKind, string> = { client_reference: "Client reference", supplier_facing: "Supplier-facing", clean: "Clean" };

/** Builds the catalog preview through the client DTO shape (clean images only) — what Piotr would see. */
function previewDto(p: ProductDetail, form: { referencePrice: string; referenceMoq: string; referenceIncoterm: string; referencePort: string; referenceSpecVersion: string; referenceValidUntil: string }): ClientCatalogDto {
  const clean = p.images.find((i) => i.kind === "clean");
  const price = form.referencePrice ? Math.round(Number(form.referencePrice.replace(",", ".")) * 10000) : null;
  return {
    id: p.id, ref: p.ref, name: p.name, category: p.category, unit: p.unit, image: clean ? { id: clean.id, url: clean.url } : null,
    referencePrice: price != null && !Number.isNaN(price) ? { minorE2: price, currency: "USD", unit: p.unit } : null,
    referenceMoq: form.referenceMoq ? Number(form.referenceMoq) : null, referenceIncoterm: form.referenceIncoterm || null, referencePort: form.referencePort || null,
    referenceSpecVersion: form.referenceSpecVersion ? Number(form.referenceSpecVersion) : null, referenceValidUntil: form.referenceValidUntil || null,
    priceStale: !form.referenceValidUntil || form.referenceValidUntil < new Date().toISOString().slice(0, 10), orderedBefore: false,
  };
}

export function ProductPage({ p, isAdmin, owners, actions }: { p: ProductDetail; isAdmin: boolean; owners: { id: string; name: string }[]; actions: Actions }) {
  const router = useRouter();
  const [form, setForm] = React.useState({
    name: p.name, category: p.category ?? "", description: p.description ?? "", hsCode: p.hsCode ?? "", unit: p.unit, ownerOrgId: p.ownerOrgId ?? "",
    referencePrice: e2ToText(p.referencePriceMinorE2), referenceMoq: p.referenceMoq?.toString() ?? "", referenceIncoterm: p.referenceIncoterm ?? "", referencePort: p.referencePort ?? "",
    referenceSpecVersion: p.referenceSpecVersion?.toString() ?? (p.specs[0]?.version.toString() ?? ""), referenceValidUntil: p.referenceValidUntil ?? "",
  });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [saving, setSaving] = React.useState(false);
  const [publishOpen, setPublishOpen] = React.useState(false);
  const set = (k: keyof typeof form, v: string) => setForm((s) => ({ ...s, [k]: v }));
  const dirty = form.name !== p.name || form.category !== (p.category ?? "") || form.description !== (p.description ?? "") || form.hsCode !== (p.hsCode ?? "") || form.unit !== p.unit || form.ownerOrgId !== (p.ownerOrgId ?? "")
    || form.referencePrice !== e2ToText(p.referencePriceMinorE2) || form.referenceMoq !== (p.referenceMoq?.toString() ?? "") || form.referenceIncoterm !== (p.referenceIncoterm ?? "") || form.referencePort !== (p.referencePort ?? "")
    || form.referenceSpecVersion !== (p.referenceSpecVersion?.toString() ?? (p.specs[0]?.version.toString() ?? "")) || form.referenceValidUntil !== (p.referenceValidUntil ?? "");

  const refInput = (): ReferenceFormInput => ({ referencePrice: form.referencePrice, referenceMoq: form.referenceMoq, referenceIncoterm: form.referenceIncoterm, referencePort: form.referencePort, referenceSpecVersion: form.referenceSpecVersion, referenceValidUntil: form.referenceValidUntil });
  const save = async () => {
    setSaving(true); setErrors({});
    try {
      const r = await actions.update({ id: p.id, name: form.name, category: (form.category || "") as never, description: form.description || null, hsCode: form.hsCode || null, unit: form.unit || "pcs", ownerOrgId: form.ownerOrgId || "", ...refInput() });
      if (!r.ok) { setErrors(r.errors ?? { _: r.error }); toast.error(r.error === "E_LEAK_CHECK" ? `Blocked: ${r.hits?.map((h) => h.match).join(", ")}` : r.errors ? "Check the highlighted fields" : r.error); return; }
      toast.success("Product saved");
      router.refresh();
    } finally { setSaving(false); }
  };

  const cleanCount = p.images.filter((i) => i.kind === "clean").length;
  const lineColumns: DataTableColumn<ProductDetail["lines"][number]>[] = [
    { id: "ref", accessorKey: "lineRef", header: "Line", meta: { sticky: true }, cell: ({ row }) => <span className="inline-flex items-center gap-1.5 font-mono text-xs">{row.original.lineRef}{row.original.fromCatalog && <UtilityBadge kind="catalog">Catalog</UtilityBadge>}</span> },
    { id: "client", accessorKey: "orgName", header: "Client" },
    { id: "state", accessorKey: "state", header: "State", cell: ({ row }) => <StateChip state={row.original.state} /> },
    { id: "qty", accessorKey: "qty", header: "Qty", meta: { numeric: true }, cell: ({ row }) => (row.original.qty != null ? <Qty qty={row.original.qty} unit={row.original.unit} /> : "—") },
    { id: "spec", accessorKey: "specVersion", header: "Spec", cell: ({ row }) => (row.original.specVersion != null ? <UtilityBadge kind="version">v{row.original.specVersion}</UtilityBadge> : <span className="text-faint">—</span>) },
    { id: "created", accessorKey: "createdAt", header: "Created", meta: { numeric: true }, cell: ({ row }) => <DateTime value={row.original.createdAt} variant="short" /> },
  ];
  const orderColumns: DataTableColumn<ProductDetail["orders"][number]>[] = [
    { id: "ref", accessorKey: "orderRef", header: "Order", meta: { sticky: true }, cell: ({ row }) => <span className="font-mono text-xs">{row.original.orderRef}</span> },
    { id: "client", accessorKey: "orgName", header: "Client" },
    { id: "supplier", accessorKey: "supplierName", header: "Factory", cell: ({ row }) => (row.original.supplierName ? <PrimaryCell title={row.original.supplierName} sub={row.original.supplierRef ?? undefined} /> : <span className="text-faint">—</span>) },
    { id: "state", accessorKey: "state", header: "State", cell: ({ row }) => <StateChip state={row.original.state} /> },
    { id: "qty", accessorKey: "qty", header: "Qty", meta: { numeric: true }, cell: ({ row }) => <Qty qty={row.original.qty} unit={row.original.unit} /> },
    { id: "price", accessorKey: "unitPriceMinorE2", header: "Client price", meta: { numeric: true, strong: true }, cell: ({ row }) => <UnitPrice minorE2={row.original.unitPriceMinorE2} currency={row.original.currency} unit={row.original.unit} /> },
    { id: "confirmed", accessorKey: "confirmedAt", header: "Confirmed", meta: { numeric: true }, cell: ({ row }) => (row.original.confirmedAt ? <DateTime value={row.original.confirmedAt} variant="short" /> : "—") },
    { id: "delivered", accessorKey: "deliveredAt", header: "Delivered", meta: { numeric: true }, cell: ({ row }) => (row.original.deliveredAt ? <DateTime value={row.original.deliveredAt} variant="short" /> : "—") },
  ];

  const publishButton = (
    <Button variant={p.visibility === "catalog" ? "outline" : "default"} disabled={!isAdmin} onClick={() => setPublishOpen(true)} data-testid={p.visibility === "catalog" ? "unpublish" : "publish"}>
      {p.visibility === "catalog" ? "Unpublish" : "Publish to catalog"}
    </Button>
  );

  return (
    <>
      <PageHeader
        sticky crumbs={[{ href: "/ops/products", label: "Products" }, { label: <span className="font-mono">{p.ref}</span> }]} eyebrow={<>{p.ref}{p.ownerOrgName && <> · {p.ownerOrgName}</>}{p.category && <> · {label("productCategory", p.category)}</>}</>} title={p.name}
        meta={<><VisibilityChip visibility={p.visibility} />{p.publishedAt && <span className="text-xs text-muted-foreground">published <DateTime value={p.publishedAt} variant="short" /></span>}{p.priceStale && <Badge variant="danger">reference price expired</Badge>}<span className="font-mono text-xs text-muted-foreground">{p.specs.length} spec {p.specs.length === 1 ? "version" : "versions"} · {cleanCount} clean {cleanCount === 1 ? "image" : "images"}</span></>}
        actions={
          <>
            {dirty && <span className="inline-flex h-6 items-center rounded-full border border-warning-border bg-warning-wash px-2.5 text-xs font-medium text-warning">Unsaved changes</span>}
            {(dirty || saving) && <Button variant="outline" onClick={save} disabled={!dirty || saving} data-testid="save-product">{saving && <Loader2 className="animate-spin" />}Save</Button>}
            {isAdmin ? publishButton : <Tooltip><TooltipTrigger asChild><span tabIndex={0}>{publishButton}</span></TooltipTrigger><TooltipContent>Admin only</TooltipContent></Tooltip>}
          </>
        }
      />
      <PublishDialog p={p} open={publishOpen} onOpenChange={setPublishOpen} form={form} publish={actions.publish} unpublish={actions.unpublish} />

      <div className="grid xl:grid-cols-[minmax(0,1fr)_22rem]">
        <Tabs defaultValue="overview" className="min-w-0 py-6 xl:pr-6">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="images">Images <span className="font-mono text-xs text-muted-foreground">{p.images.length}</span></TabsTrigger>
            <TabsTrigger value="specs">Specs <span className="font-mono text-xs text-muted-foreground">{p.specs.length}</span></TabsTrigger>
            <TabsTrigger value="orders">Orders <span className="font-mono text-xs text-muted-foreground">{p.orders.length}</span></TabsTrigger>
            <TabsTrigger value="requests">Requests <span className="font-mono text-xs text-muted-foreground">{p.lines.length}</span></TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="pt-4">
            <div className="grid gap-6 lg:grid-cols-2">
              <section className="rounded-xl border border-border bg-card p-5" aria-labelledby="product-h">
                <h2 id="product-h" className="eyebrow mb-4">Product</h2>
                <div className="flex flex-col gap-4">
                  <FieldRow label="Name" htmlFor="name" error={errors.name}><Input id="name" value={form.name} onChange={(e) => set("name", e.target.value)} aria-invalid={!!errors.name} /></FieldRow>
                  <div className="grid grid-cols-2 gap-4">
                    <FieldRow label="Category" htmlFor="category">
                      <Select value={form.category || NONE} onValueChange={(x) => set("category", x === NONE ? "" : x)}>
                        <SelectTrigger id="category" className="w-full"><SelectValue placeholder="—" /></SelectTrigger>
                        <SelectContent><SelectItem value={NONE}>—</SelectItem>{PRODUCT_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                      </Select>
                    </FieldRow>
                    <FieldRow label="Unit" htmlFor="unit" error={errors.unit}><Input id="unit" value={form.unit} onChange={(e) => set("unit", e.target.value)} className="font-mono" /></FieldRow>
                    <FieldRow label="Owner org" htmlFor="owner">
                      <Select value={form.ownerOrgId || NONE} onValueChange={(x) => set("ownerOrgId", x === NONE ? "" : x)}>
                        <SelectTrigger id="owner" className="w-full"><SelectValue placeholder="—" /></SelectTrigger>
                        <SelectContent><SelectItem value={NONE}>— (agency)</SelectItem>{owners.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}</SelectContent>
                      </Select>
                    </FieldRow>
                    <FieldRow label="HS code" htmlFor="hsCode"><Input id="hsCode" value={form.hsCode} onChange={(e) => set("hsCode", e.target.value)} className="font-mono" /></FieldRow>
                  </div>
                  <FieldRow label="Description" htmlFor="description" error={errors.description} hint="Client-facing once published — the leak check runs on it"><Textarea id="description" rows={5} value={form.description} onChange={(e) => set("description", e.target.value)} aria-invalid={!!errors.description} /></FieldRow>
                </div>
              </section>
              <section className="rounded-xl border border-border bg-card p-5" aria-labelledby="ref-h" data-testid="reference-price">
                <h2 id="ref-h" className="eyebrow mb-1">Reference price</h2>
                <p className="mb-4 text-xs text-muted-foreground">Always all-in per unit at the MOQ (D-11). All five attributes and a valid-until date are required to publish.</p>
                <div className="grid grid-cols-2 gap-4">
                  <FieldRow label="Price USD / unit" htmlFor="referencePrice" error={errors.referencePrice}>
                    <div className="relative"><span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 font-mono text-sm text-muted-foreground">$</span><Input id="referencePrice" inputMode="decimal" value={form.referencePrice} onChange={(e) => set("referencePrice", e.target.value)} className="pl-6 text-right font-mono" placeholder="0.0000" aria-invalid={!!errors.referencePrice} /></div>
                  </FieldRow>
                  <FieldRow label="MOQ" htmlFor="referenceMoq" error={errors.referenceMoq}>
                    <div className="relative"><Input id="referenceMoq" inputMode="numeric" value={form.referenceMoq} onChange={(e) => set("referenceMoq", e.target.value.replace(/\D/g, ""))} className="pr-12 text-right font-mono" aria-invalid={!!errors.referenceMoq} /><span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 font-mono text-xs text-muted-foreground">{form.unit}</span></div>
                  </FieldRow>
                  <FieldRow label="Incoterm" htmlFor="referenceIncoterm" error={errors.referenceIncoterm}>
                    <Select value={form.referenceIncoterm || NONE} onValueChange={(x) => set("referenceIncoterm", x === NONE ? "" : x)}>
                      <SelectTrigger id="referenceIncoterm" className="w-full" aria-invalid={!!errors.referenceIncoterm}><SelectValue placeholder="—" /></SelectTrigger>
                      <SelectContent><SelectItem value={NONE}>—</SelectItem>{INCOTERMS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                    </Select>
                  </FieldRow>
                  <FieldRow label="Port" htmlFor="referencePort" error={errors.referencePort}><Input id="referencePort" value={form.referencePort} onChange={(e) => set("referencePort", e.target.value)} placeholder="Qingdao" aria-invalid={!!errors.referencePort} /></FieldRow>
                  <FieldRow label="Spec version" htmlFor="referenceSpecVersion" error={errors.referenceSpecVersion}>
                    <Select value={form.referenceSpecVersion || NONE} onValueChange={(x) => set("referenceSpecVersion", x === NONE ? "" : x)}>
                      <SelectTrigger id="referenceSpecVersion" className="w-full font-mono" aria-invalid={!!errors.referenceSpecVersion}><SelectValue placeholder="—" /></SelectTrigger>
                      <SelectContent><SelectItem value={NONE}>—</SelectItem>{p.specs.map((s) => <SelectItem key={s.id} value={String(s.version)}>v{s.version}{s.frozenAt ? ` · frozen ${formatDate(s.frozenAt)}` : " · draft"}</SelectItem>)}</SelectContent>
                    </Select>
                  </FieldRow>
                  <FieldRow label="Valid until" htmlFor="referenceValidUntil" error={errors.referenceValidUntil}><DateInput id="referenceValidUntil" value={form.referenceValidUntil} onChange={(e) => set("referenceValidUntil", e.target.value)} aria-invalid={!!errors.referenceValidUntil} /></FieldRow>
                </div>
                <div className="mt-4 rounded-lg bg-section-alt px-3 py-2 text-xs text-ink-2">
                  Stored: {p.referencePriceMinorE2 != null ? <UnitPrice minorE2={p.referencePriceMinorE2} currency={p.referenceCurrency} unit={p.unit} /> : <span className="text-faint">no price</span>}{p.referenceMoq != null && <> at <Qty qty={p.referenceMoq} unit={p.unit} /></>}{p.referenceValidUntil && <> · <ValidUntil value={p.referenceValidUntil} stale={p.priceStale} expiring={false} /></>}
                </div>
                {errors._ && <p className="mt-2 flex items-center gap-1 text-xs text-danger" role="alert"><AlertCircle className="size-3" />{errors._}</p>}
              </section>
            </div>
          </TabsContent>

          <TabsContent value="images" className="pt-4">
            <ImagesTab p={p} actions={actions} />
          </TabsContent>

          <TabsContent value="specs" className="pt-4">
            {p.specs.length === 0 ? <div className="rounded-xl border border-border bg-card"><EmptyState title="No spec versions" body="Specs are frozen from a line's Spec tab." /></div> : (
              <ul className="flex flex-col gap-4" data-testid="specs">
                {p.specs.map((s) => (
                  <li key={s.id} className="rounded-xl border border-border bg-card" data-version={s.version}>
                    <div className="flex items-center gap-2 border-b border-hairline-faint px-5 py-3">
                      <UtilityBadge kind="version">v{s.version}</UtilityBadge>
                      {s.frozenAt ? <Badge variant="success"><Check className="size-3" />frozen</Badge> : <Badge variant="neutral">draft</Badge>}
                      {s.frozenAt && <span className="text-xs text-muted-foreground"><DateTime value={s.frozenAt} />{s.frozenByName && <> · {s.frozenByName}</>}</span>}
                      {p.referenceSpecVersion === s.version && <Badge variant="green" className="ml-auto">reference</Badge>}
                    </div>
                    {Object.keys(s.fields).length === 0 ? <p className="px-5 py-3 text-sm text-muted-foreground">No fields yet.</p> : (
                      <dl className="grid grid-cols-1 divide-y divide-hairline-faint sm:grid-cols-2 sm:divide-y-0">
                        {Object.entries(s.fields).map(([k, v]) => <div key={k} className="grid grid-cols-[9rem_1fr] gap-3 px-5 py-2 text-sm"><dt className="text-muted-foreground">{specKeyLabel(k)}</dt><dd className="font-medium">{specValueLabel(v)}</dd></div>)}
                      </dl>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>

          <TabsContent value="orders" className="pt-4">
            <p className="mb-2 flex items-center gap-2 text-xs text-muted-foreground"><VisibilityBadge visibility="internal" />Orders by client (D-19) — the factory column never leaves ops.</p>
            <DataTable columns={orderColumns} data={p.orders} rowHref={(r) => `/ops/orders/${r.orderRef}`} density="compact" data-testid="product-orders" emptyState={<EmptyState title="No orders of this product yet" className="py-8" />} />
          </TabsContent>

          <TabsContent value="requests" className="pt-4">
            <DataTable columns={lineColumns} data={p.lines} rowHref={(r) => `/ops/lines/${r.lineRef}`} density="compact" data-testid="product-lines" emptyState={<EmptyState title="No request lines reference this product" className="py-8" />} />
          </TabsContent>
        </Tabs>

        <aside className="band-alt -mb-12 py-6 xl:-mr-6 xl:border-l xl:border-hairline-strong xl:px-5 xl:[border-image:none]" data-testid="catalog-preview"><div className="xl:sticky-under-header">
          <p className="eyebrow mb-3">Catalog preview · as the client sees it</p>
          <CatalogCard p={previewDto(p, form)} action={<Button variant="outline" className="w-full" disabled>Request offer</Button>} />
          <p className="mt-3 text-xs text-muted-foreground">{p.visibility === "catalog" ? "Live in the catalog for every client." : "Not in the catalog. Publish to make it visible to every client."}</p>
        </div></aside>
      </div>
    </>
  );
}

function ImagesTab({ p, actions }: { p: ProductDetail; actions: Actions }) {
  const router = useRouter();
  const [kind, setKind] = React.useState<ImageKind>("clean");
  const [busy, setBusy] = React.useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const upload = async (file: File) => {
    setBusy("upload");
    try {
      const fd = new FormData(); fd.set("file", file); fd.set("productId", p.id); fd.set("productRef", p.ref); fd.set("kind", kind);
      const r = await actions.uploadImage(fd);
      if (!r.ok) { toast.error(r.error === "E_LEAK_CHECK" ? `Blocked: ${r.hits?.map((h) => h.match).join(", ")}` : r.errors?.file ?? r.error); return; }
      toast.success(`${KIND_LABEL[kind]} image added`);
      router.refresh();
    } finally { setBusy(null); if (fileRef.current) fileRef.current.value = ""; }
  };
  const groups = IMAGE_KINDS.map((k) => ({ k, items: p.images.filter((i) => i.kind === k) }));
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-section-alt px-4 py-3">
        <span className="text-sm text-ink-2">Upload as</span>
        <Select value={kind} onValueChange={(x) => setKind(x as ImageKind)}>
          <SelectTrigger size="sm" className="bg-card" aria-label="Image kind"><SelectValue /></SelectTrigger>
          <SelectContent>{IMAGE_KINDS.map((k) => <SelectItem key={k} value={k}>{KIND_LABEL[k]}</SelectItem>)}</SelectContent>
        </Select>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" id="image-file" data-testid="image-file" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
        <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={busy === "upload"} data-testid="upload-image">{busy === "upload" ? <Loader2 className="animate-spin" /> : <Upload data-icon="inline-start" />}Upload image</Button>
        <span className="text-xs text-muted-foreground">png, jpg, webp · ≤ 15 MB · re-encoded, metadata stripped. Only <strong>clean</strong> images ever reach a client.</span>
      </div>
      {groups.map(({ k, items }) => (
        <section key={k} aria-label={KIND_LABEL[k]}>
          <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">{KIND_LABEL[k]} <span className="font-mono text-xs font-normal text-muted-foreground">{items.length}</span>{k === "supplier_facing" && <Badge variant="warning"><EyeOff className="size-3" />never shown to clients</Badge>}{k === "clean" && <Badge variant="success">catalog</Badge>}</h3>
          {items.length === 0 ? <p className="text-sm text-muted-foreground">None.</p> : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" data-testid={`images-${k}`}>
              {items.map((img) => <ImageTile key={img.id} img={img} p={p} busy={busy} setBusy={setBusy} actions={actions} />)}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

function ImageTile({ img, p, busy, setBusy, actions }: { img: ProductImage; p: ProductDetail; busy: string | null; setBusy: (b: string | null) => void; actions: Actions }) {
  const router = useRouter();
  return (
    <li className="overflow-hidden rounded-xl border border-border bg-card" data-testid="image-tile" data-kind={img.kind}>
      <div className="relative aspect-[4/3] bg-section-alt">
        {/* eslint-disable-next-line @next/next/no-img-element -- /api/files, access-checked */}
        <img src={img.url} alt={img.filename} className={cn("size-full object-cover", img.kind === "supplier_facing" && "opacity-80")} />
        {img.kind === "supplier_facing" && <span className="absolute top-2 left-2 inline-flex size-6 items-center justify-center rounded-md bg-foreground/70 text-white"><EyeOff className="size-3.5" /></span>}
      </div>
      <div className="flex items-center gap-1 px-2 py-1.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium" title={img.filename}>{img.filename}</p>
          <p className="text-2xs text-muted-foreground">{img.approvedByName ? `approved · ${img.approvedByName}` : img.exifStripped ? "metadata stripped" : "raw"}</p>
        </div>
        {img.kind !== "clean" && (
          <Button variant="ghost" size="icon-sm" aria-label="Mark as clean" title="Mark as clean (copies to the catalog set)" disabled={busy === img.id} data-testid="mark-clean"
            onClick={async () => { setBusy(img.id); const r = await actions.approveImage({ imageId: img.id, productRef: p.ref }); setBusy(null); if (r.ok) { toast.success("Clean image approved"); router.refresh(); } else toast.error(r.error === "E_LEAK_CHECK" ? `Blocked: ${r.hits?.map((h) => h.match).join(", ")}` : r.error); }}>
            {busy === img.id ? <Loader2 className="animate-spin" /> : <Sparkles />}
          </Button>
        )}
        <Button variant="ghost" size="icon-sm" aria-label="Remove image" disabled={busy === img.id}
          onClick={async () => { if (!confirm("Remove this image?")) return; setBusy(img.id); const r = await actions.removeImage({ imageId: img.id, productRef: p.ref }); setBusy(null); if (r.ok) { toast.success("Image removed"); router.refresh(); } else toast.error(r.error === "E_FORBIDDEN" ? "A published product keeps at least one clean image" : r.error); }}>
          <Trash2 />
        </Button>
      </div>
    </li>
  );
}

function CheckRow({ ok, label, detail }: { ok: boolean | null; label: string; detail?: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 py-2 text-sm">
      <span className={cn("mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full", ok === null ? "bg-neutral-wash text-neutral" : ok ? "bg-success-wash text-success" : "bg-danger-wash text-danger")}>{ok === null ? <span className="size-1.5 rounded-full bg-current" /> : ok ? <Check className="size-3" /> : <X className="size-3" />}</span>
      <span className="flex-1"><span className="font-medium">{label}</span>{detail && <span className="mt-0.5 block text-xs text-ink-2">{detail}</span>}</span>
    </li>
  );
}

/** DESIGN §5.16 — "Publish to catalog": check rows (reference price · clean image · leak check), green Publish when clean. */
function PublishDialog({ p, open, onOpenChange, form, publish, unpublish }: {
  p: ProductDetail; open: boolean; onOpenChange: (o: boolean) => void;
  form: { referencePrice: string; referenceMoq: string; referenceIncoterm: string; referencePort: string; referenceSpecVersion: string; referenceValidUntil: string };
  publish: Actions["publish"]; unpublish: Actions["unpublish"];
}) {
  const router = useRouter();
  const [withoutImage, setWithoutImage] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [result, setResult] = React.useState<{ errors?: Record<string, string>; hits?: { kind: string; match: string; where: string }[] } | null>(null);
  const today = new Date().toISOString().slice(0, 10);
  const priceOk = !!form.referencePrice && Number(form.referencePrice.replace(",", ".")) > 0;
  const missing = [
    !priceOk && "price", !form.referenceMoq && "MOQ", !form.referenceIncoterm && "incoterm", !form.referencePort && "port", !form.referenceSpecVersion && "spec version",
    !form.referenceValidUntil ? "valid until" : form.referenceValidUntil < today ? "valid until (in the past)" : false,
  ].filter(Boolean) as string[];
  const cleanCount = p.images.filter((i) => i.kind === "clean").length;
  const imageOk = cleanCount > 0 || withoutImage;
  const canPublish = missing.length === 0 && imageOk && !pending;
  if (p.visibility === "catalog") {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Unpublish from catalog</DialogTitle><DialogDescription>{p.ref} {p.name} becomes private. Clients lose the card and its reference price; existing requests are unaffected.</DialogDescription></DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button variant="destructive" disabled={pending} data-testid="confirm-unpublish" onClick={async () => { setPending(true); const r = await unpublish({ id: p.id }); setPending(false); if (r.ok) { toast.success("Unpublished — now private"); onOpenChange(false); router.refresh(); } else toast.error(r.error); }}>{pending && <Loader2 className="animate-spin" />}Unpublish</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }
  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setResult(null); }}>
      <DialogContent className="max-w-md" data-testid="publish-dialog">
        <DialogHeader><DialogTitle>Publish to catalog</DialogTitle><DialogDescription>{p.ref} · {p.name}. Every client will see the card with this reference price.</DialogDescription></DialogHeader>
        <ul className="divide-y divide-hairline-faint">
          <CheckRow ok={missing.length === 0} label="Reference price complete" detail={missing.length ? `Missing: ${missing.join(", ")} — fill them in on the Overview tab` : `${form.referencePrice ? `$${form.referencePrice}` : ""} / ${p.unit} at ${form.referenceMoq} · ${form.referenceIncoterm} ${form.referencePort} · spec v${form.referenceSpecVersion} · valid until ${form.referenceValidUntil}`} />
          <CheckRow ok={imageOk} label={cleanCount > 0 ? `${cleanCount} clean ${cleanCount === 1 ? "image" : "images"}` : "No clean image"} detail={cleanCount === 0 && (
            <label className="mt-1 flex items-center gap-2"><input type="checkbox" checked={withoutImage} onChange={(e) => setWithoutImage(e.target.checked)} className="size-4 rounded-sm accent-green-600" data-testid="without-image" />Publish without image</label>
          )} />
          <CheckRow ok={result ? (result.hits ? false : true) : null} label="Leak check on name + description" detail={result?.hits ? <span className="font-mono text-danger">{result.hits.map((h) => `${h.kind}: “${h.match}” in ${h.where}`).join(" · ")}</span> : "Runs on publish — blocks if a factory name, handle or phone appears"} />
        </ul>
        {result?.errors && <p className="text-xs text-danger" role="alert">{Object.values(result.errors).join(" · ")}</p>}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          {result?.hits ? <Button disabled>Fix and try again</Button> : (
            <Button variant="green" disabled={!canPublish} data-testid="confirm-publish" onClick={async () => {
              setPending(true); setResult(null);
              const r = await publish({ id: p.id, withoutImage, ...form });
              setPending(false);
              if (!r.ok) { setResult({ errors: r.errors, hits: r.hits }); toast.error(r.error === "E_LEAK_CHECK" ? "Blocked by the leak check" : "Cannot publish yet"); return; }
              toast.success(`${p.ref} is in the catalog`); onOpenChange(false); router.refresh();
            }}>{pending && <Loader2 className="animate-spin" />}Publish</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
