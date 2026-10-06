"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, X, Upload, Plus, Pencil, Trash2, Loader2, Download, ImagePlus, ShieldCheck } from "lucide-react";
import type { RangeDetail, RangeItem, RangeLeakReport } from "@/server/ops/ranges";
import type { ActionResult } from "@/server/shared/http";
import type { RangeItemFormInput } from "@/app/(ops)/ops/factory-ranges/actions";
import type { LineState } from "@/db/enums";
import { PageHeader, EyebrowLink } from "@/components/shared/page-header";
import { label } from "@/lib/labels";
import { UNITS } from "@/db/enums";
import { NativeSelect } from "@/components/ui/native-select";
import { FactoryLabel } from "@/components/shared/factory-label";
import { FormShell } from "@/components/shared/form-shell";
import { StateChip, VisibilityBadge } from "@/components/shared/chips";
import { EmptyState } from "@/components/shared/empty-state";
import { DateTime, Qty, UnitPrice } from "@/components/shared/formatters";
import { formatBytes } from "@/components/shared/document-row";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { FieldRow } from "@/components/ops/suppliers/supplier-form";
import { RangeStatus } from "./ranges-table";
import { cn } from "@/lib/utils";

type Actions = {
  uploadPdf: (fd: FormData) => Promise<ActionResult<{ fileId: string }>>;
  addItem: (i: { rangeId: string; rangeRef: string } & RangeItemFormInput) => Promise<ActionResult<{ id: string }>>;
  updateItem: (i: { itemId: string; rangeRef: string } & RangeItemFormInput) => Promise<ActionResult<undefined>>;
  removeItem: (i: { itemId: string; rangeRef: string }) => Promise<ActionResult<undefined>>;
  uploadItemImage: (fd: FormData) => Promise<ActionResult<{ fileId: string }>>;
  check: (i: { rangeId: string }) => Promise<ActionResult<RangeLeakReport>>;
  publish: (i: { rangeId: string; rangeRef: string }) => Promise<ActionResult<{ ref: string; label: string }>>;
  unpublish: (i: { rangeId: string; rangeRef: string }) => Promise<ActionResult<{ ref: string }>>;
  rename: (i: { rangeId: string; rangeRef: string; displayName: string }) => Promise<ActionResult<undefined>>;
};
type ProductOpt = { id: string; ref: string; name: string };
const NONE = "__none__";
const e2ToText = (e2: number | null) => (e2 == null ? "" : (e2 / 10000).toFixed(4).replace(/\.?0+$/, ""));

export function RangePage({ r, isAdmin, products, actions }: { r: RangeDetail; isAdmin: boolean; products: ProductOpt[]; actions: Actions }) {
  const router = useRouter();
  const [itemOpen, setItemOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<RangeItem | null>(null);
  const [publishOpen, setPublishOpen] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  const pdfRef = React.useRef<HTMLInputElement>(null);
  const imgRefs = React.useRef<Record<string, HTMLInputElement | null>>({});
  const published = !!r.publishedAt;

  const uploadPdf = async (file: File) => {
    setBusy("pdf");
    const fd = new FormData(); fd.set("file", file); fd.set("rangeId", r.id); fd.set("rangeRef", r.ref);
    const res = await actions.uploadPdf(fd);
    setBusy(null); if (pdfRef.current) pdfRef.current.value = "";
    if (!res.ok) { toast.error(res.errors?.file ?? res.error); return; }
    toast.success("PDF uploaded (internal until publish)"); router.refresh();
  };
  const uploadImage = async (itemId: string, file: File) => {
    setBusy(itemId);
    const fd = new FormData(); fd.set("file", file); fd.set("itemId", itemId); fd.set("rangeRef", r.ref);
    const res = await actions.uploadItemImage(fd);
    setBusy(null);
    if (!res.ok) { toast.error(res.errors?.file ?? res.error); return; }
    toast.success("Item image added"); router.refresh();
  };
  const publishBtn = (
    <Button variant={published ? "outline" : "default"} disabled={!isAdmin} onClick={() => setPublishOpen(true)} data-testid={published ? "unpublish-range" : "publish-range"}>{published ? "Unpublish" : "Publish to client"}</Button>
  );

  return (
    <>
      <PageHeader
        sticky
        crumbs={[{ href: "/ops/factory-ranges", label: "Factory ranges" }, { label: <span className="font-mono">{r.ref}</span> }]}
        eyebrow={<>{r.ref} · <EyebrowLink href={`/ops/suppliers/${r.supplierRef}`}>{r.supplierRef}</EyebrowLink> · shown to {r.orgName}</>}
        title={<span className="inline-flex flex-wrap items-center gap-3">{r.supplierName}{r.label && <FactoryLabel label={r.label} disclosed={false} />}</span>}
        meta={<><RangeStatus r={{ publishedAt: r.publishedAt, leakOk: r.leakCheckResult ? r.leakCheckResult.ok : null }} />{r.publishedAt && <span className="text-xs text-muted-foreground">published <DateTime value={r.publishedAt} />{r.approvedByName && <> by {r.approvedByName}</>}</span>}<span className="font-mono text-xs text-muted-foreground">{r.items.length} items</span>{r.supplierCity && <span className="text-xs text-muted-foreground">{r.supplierCity}</span>}</>}
        actions={
          <>
            <Button variant="outline" onClick={() => { setEditing(null); setItemOpen(true); }} data-testid="add-item"><Plus data-icon="inline-start" />Item</Button>
            {isAdmin ? publishBtn : <Tooltip><TooltipTrigger asChild><span tabIndex={0}>{publishBtn}</span></TooltipTrigger><TooltipContent>Admin only</TooltipContent></Tooltip>}
          </>
        }
      />
      <ItemForm rangeId={r.id} rangeRef={r.ref} item={editing} products={products} open={itemOpen} onOpenChange={setItemOpen} onAdd={actions.addItem} onUpdate={actions.updateItem} />
      <PublishRangeDialog r={r} open={publishOpen} onOpenChange={setPublishOpen} check={actions.check} publish={actions.publish} unpublish={actions.unpublish} />

      <div className="grid xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-8 py-6 xl:pr-6">
          <section aria-labelledby="pdf-h" data-testid="range-pdf-section">
            <div className="mb-3 flex items-center justify-between gap-3 border-t border-rule-ink pt-4">
              <h2 id="pdf-h" className="flex items-center gap-3 text-lg font-semibold"><span className="inline-flex h-[22px] items-center rounded-full border border-green-200 bg-green-50 px-2.5 font-mono text-2xs font-medium text-green-700">01</span>Sanitised PDF</h2>
              <input ref={pdfRef} type="file" accept="application/pdf,.pdf" className="sr-only" data-testid="range-pdf-file" onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadPdf(f); }} />
              <Button variant="outline" size="sm" onClick={() => pdfRef.current?.click()} disabled={busy === "pdf"} data-testid="upload-range-pdf">{busy === "pdf" ? <Loader2 className="animate-spin" /> : <Upload data-icon="inline-start" />}{r.pdfSource ? "Replace PDF" : "Upload PDF"}</Button>
            </div>
            <p className="mb-3 text-xs text-muted-foreground">Upload the range with every factory identifier already removed. It stays internal; on publish the text layer is leak-checked and a client copy named “Factory-F-nnnn-range.pdf” is written under the client prefix.</p>
            <ul className="sheet">
              {r.pdfSource ? (
                <li className="sheet-row flex items-center gap-3" data-testid="range-pdf-source">
                  <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{r.pdfSource.filename}</p><p className="text-xs text-muted-foreground">source · <span className="font-mono">{formatBytes(r.pdfSource.bytes)}</span></p></div>
                  <VisibilityBadge visibility="internal" />
                  <Button asChild variant="ghost" size="icon-sm" aria-label="Download source"><a href={`${r.pdfSource.url}?dl=1`}><Download /></a></Button>
                </li>
              ) : !r.pdfClient ? <li className="sheet-row text-sm text-muted-foreground">No PDF yet — optional, but clients expect it.</li> : null}
              {r.pdfClient && (
                <li className="sheet-row flex items-center gap-3" data-testid="range-pdf-client">
                  <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{r.pdfClient.filename}</p><p className="text-xs text-muted-foreground">client copy · <span className="font-mono">{formatBytes(r.pdfClient.bytes)}</span></p></div>
                  <VisibilityBadge visibility={published ? "client" : "internal"} />
                  <Button asChild variant="ghost" size="icon-sm" aria-label="Download client copy"><a href={`${r.pdfClient.url}?dl=1`}><Download /></a></Button>
                </li>
              )}
            </ul>
          </section>

          <section aria-labelledby="items-h">
            <div className="mb-3 flex items-center justify-between gap-3 border-t border-rule-ink pt-4">
              <h2 id="items-h" className="flex items-center gap-3 text-lg font-semibold"><span className="inline-flex h-[22px] items-center rounded-full border border-green-200 bg-green-50 px-2.5 font-mono text-2xs font-medium text-green-700">02</span>Items <span className="font-mono text-sm font-normal text-muted-foreground">{r.items.length}</span></h2>
              <Button variant="outline" size="sm" onClick={() => { setEditing(null); setItemOpen(true); }}><Plus data-icon="inline-start" />Add item</Button>
            </div>
            {r.items.length === 0 ? (
              <div className="rounded-xl border border-border bg-card"><EmptyState title="No items yet" body="Name, MOQ and an indicative USD price per item. Keep names generic — no model codes that name the factory." action={<Button onClick={() => { setEditing(null); setItemOpen(true); }}><Plus data-icon="inline-start" />Add item</Button>} /></div>
            ) : (
              <ul className="sheet" data-testid="range-items-ops">
                {r.items.map((it, i) => (
                  <li key={it.id} className="sheet-row flex items-center gap-3" data-testid="range-item-ops">
                    <span className="w-6 font-mono text-xs text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
                    <button type="button" className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-section-alt" title={it.imageUrl ? `Replace image (${it.imageFilename})` : "Add clean image"} onClick={() => imgRefs.current[it.id]?.click()} disabled={busy === it.id} aria-label={it.imageUrl ? "Replace item image" : "Add item image"}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {busy === it.id ? <Loader2 className="size-4 animate-spin" /> : it.imageUrl ? <img src={it.imageUrl} alt="" className="size-full object-cover" /> : <ImagePlus className="size-4 text-muted-foreground" />}
                    </button>
                    <input ref={(el) => { imgRefs.current[it.id] = el; }} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" data-testid="item-image-file" onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadImage(it.id, f); e.target.value = ""; }} />
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 text-sm font-medium">{it.name}{it.productRef && <span className="font-mono text-xs text-muted-foreground">{it.productRef}</span>}</p>
                      <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                        {it.moq != null ? <span className="font-mono">MOQ <Qty qty={it.moq} unit={it.unit} /></span> : <span className="text-faint">no MOQ</span>}
                        {it.madeHere === true ? <Badge variant="success" className="normal-case tracking-normal">{label("provenance", "made_here")}</Badge> : it.madeHere === false ? <Badge variant="neutral" className="normal-case tracking-normal">{label("provenance", "sourced_by_them")}</Badge> : <Badge variant="dashed" className="normal-case tracking-normal">{label("provenance", "unknown")}</Badge>}
                        {it.note && !/^(sourced by (them|the factory)|made here|unknown)$/i.test(it.note.trim()) && <span>{it.note}</span>}
                      </p>
                    </div>
                    <div className="text-right">{it.priceMinorE2 != null ? <UnitPrice minorE2={it.priceMinorE2} currency={it.currency} unit={it.unit} /> : <span className="text-xs text-faint">no price</span>}</div>
                    <Button variant="ghost" size="icon-sm" aria-label="Edit item" onClick={() => { setEditing(it); setItemOpen(true); }}><Pencil /></Button>
                    <Button variant="ghost" size="icon-sm" aria-label="Remove item" onClick={async () => { if (!confirm(`Remove “${it.name}”?`)) return; const res = await actions.removeItem({ itemId: it.id, rangeRef: r.ref }); if (res.ok) { toast.success("Item removed"); router.refresh(); } else toast.error(res.error); }}><Trash2 /></Button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="leak-h" data-testid="range-leak-result">
            <div className="mb-3 border-t border-rule-ink pt-4"><h2 id="leak-h" className="flex items-center gap-3 text-lg font-semibold"><span className="inline-flex h-[22px] items-center rounded-full border border-green-200 bg-green-50 px-2.5 font-mono text-2xs font-medium text-green-700">03</span>Leak check</h2></div>
            {r.leakCheckResult ? (
              <div className={cn("rounded-xl border p-4 text-sm", r.leakCheckResult.ok ? "border-success-border bg-success-wash text-success" : "border-danger-border bg-danger-wash text-danger")}>
                <p className="flex items-center gap-2 font-medium">{r.leakCheckResult.ok ? <Check className="size-4" /> : <X className="size-4" />}{r.leakCheckResult.ok ? "No supplier identifiers found" : `${r.leakCheckResult.hits.length} ${r.leakCheckResult.hits.length === 1 ? "match" : "matches"} — publish blocked`}<span className="ml-auto font-mono text-xs font-normal"><DateTime value={r.leakCheckResult.at} variant="datetime" /></span></p>
                {!r.leakCheckResult.ok && <ul className="mt-2 flex flex-col gap-1 font-mono text-xs">{r.leakCheckResult.hits.map((h, i) => <li key={i}>{h.kind} · “{h.match}” · in {h.where}</li>)}</ul>}
              </div>
            ) : <p className="text-sm text-muted-foreground">Not run yet — it runs on publish (item names and notes, every filename, the PDF text layer). Any edit resets the result.</p>}
          </section>
        </div>

        <aside className="band-alt -mb-12 py-6 xl:-mr-6 xl:min-h-[calc(100dvh-10rem)] xl:border-l xl:border-hairline-strong xl:px-5 xl:[border-image-source:none]" data-testid="range-rail"><div className="xl:sticky-under-header">
          <p className="eyebrow mb-3">Facts</p>
          <dl className="flex flex-col gap-2 text-sm">
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Supplier</dt><dd className="text-right"><Link href={`/ops/suppliers/${r.supplierRef}`} className="link">{r.supplierName}</Link></dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Shown to</dt><dd>{r.orgName}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Shown as</dt><dd>{r.label ? <FactoryLabel label={r.label} disclosed={false} /> : <span className="text-muted-foreground">on publish</span>}</dd></div>
            <CatalogueName r={r} rename={actions.rename} />
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Created</dt><dd className="text-right"><DateTime value={r.createdAt} variant="short" />{r.createdByName && <span className="text-muted-foreground"> · {r.createdByName}</span>}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Updated</dt><dd><DateTime value={r.updatedAt} variant="short" /></dd></div>
          </dl>
          {published && <Button asChild variant="outline" size="sm" className="mt-4 w-full"><a href={`/app/ranges/${r.id}`} target="_blank" rel="noreferrer">Client URL ↗</a></Button>}
          <p className="eyebrow mt-6 mb-3">Lines requested from this range <span className="font-mono">{r.linesFromRange.length}</span></p>
          {r.linesFromRange.length === 0 ? <p className="text-sm text-muted-foreground">None yet.</p> : (
            <ul className="flex flex-col gap-1">
              {r.linesFromRange.map((l) => <li key={l.lineRef} className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm"><Link href={`/ops/lines/${l.lineRef}?tab=sourcing`} className="min-w-0"><span className="block truncate font-medium">{l.name}</span><span className="font-mono text-xs text-muted-foreground">{l.lineRef}</span></Link><StateChip state={l.state as LineState} /></li>)}
            </ul>
          )}
        </div></aside>
      </div>
    </>
  );
}

function ItemForm({ rangeId, rangeRef, item, products, open, onOpenChange, onAdd, onUpdate }: { rangeId: string; rangeRef: string; item: RangeItem | null; products: ProductOpt[]; open: boolean; onOpenChange: (o: boolean) => void; onAdd: Actions["addItem"]; onUpdate: Actions["updateItem"] }) {
  const router = useRouter();
  const blank = { name: "", productId: "", moq: "", price: "", currency: "USD", unit: "pcs", madeHere: "unknown" as "yes" | "no" | "unknown", note: "" };
  const [v, setV] = React.useState(blank);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [prevOpen, setPrevOpen] = React.useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) { setErrors({}); setV(item ? { name: item.name, productId: item.productId ?? "", moq: item.moq?.toString() ?? "", price: e2ToText(item.priceMinorE2), currency: item.currency, unit: item.unit, madeHere: item.madeHere === true ? "yes" : item.madeHere === false ? "no" : "unknown", note: item.note ?? "" } : blank); }
  }
  const set = (k: keyof typeof v, val: string) => setV((s) => ({ ...s, [k]: val }));
  return (
    <FormShell open={open} onOpenChange={onOpenChange} eyebrow={rangeRef} title={item ? "Edit item" : "Add item"} submitLabel={item ? "Save" : "Add item"}
      onSubmit={async () => {
        setErrors({});
        const input: RangeItemFormInput = { name: v.name, productId: v.productId || "", moq: v.moq, price: v.price, currency: v.currency, unit: v.unit || "pcs", madeHere: v.madeHere, note: v.note || null };
        const res = item ? await onUpdate({ itemId: item.id, rangeRef, ...input }) : await onAdd({ rangeId, rangeRef, ...input });
        if (!res.ok) { setErrors(res.errors ?? { _: res.error }); toast.error(res.errors ? "Check the highlighted fields" : res.error); return false; }
        toast.success(item ? "Item saved" : "Item added"); router.refresh(); return true;
      }}>
      <FieldRow label="Name" htmlFor="it-name" error={errors.name} hint="Generic product name — never a factory model code"><Input id="it-name" value={v.name} onChange={(e) => set("name", e.target.value)} autoFocus placeholder="Toploader 55pt" aria-invalid={!!errors.name} /></FieldRow>
      <div className="grid grid-cols-2 gap-4">
        <FieldRow label="MOQ" htmlFor="it-moq" error={errors.moq}><Input id="it-moq" inputMode="numeric" value={v.moq} onChange={(e) => set("moq", e.target.value.replace(/\D/g, ""))} className="text-right font-mono" /></FieldRow>
        <FieldRow label="Unit" htmlFor="it-unit"><NativeSelect id="it-unit" value={v.unit} onChange={(e) => set("unit", e.target.value)}>{[...new Set([...UNITS, v.unit])].filter(Boolean).map((u) => <option key={u} value={u}>{label("unit", u)}</option>)}</NativeSelect></FieldRow>
        <FieldRow label="Indicative price" htmlFor="it-price" error={errors.price}>
          <div className="relative"><span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 font-mono text-sm text-muted-foreground">$</span><Input id="it-price" inputMode="decimal" value={v.price} onChange={(e) => set("price", e.target.value)} className="pl-6 text-right font-mono" placeholder="0.0000" aria-invalid={!!errors.price} /></div>
        </FieldRow>
        <FieldRow label="Currency" htmlFor="it-cur"><Input id="it-cur" value={v.currency} onChange={(e) => set("currency", e.target.value.toUpperCase())} maxLength={3} className="font-mono" /></FieldRow>
        <FieldRow label="Made here?" htmlFor="it-made">
          <Select value={v.madeHere} onValueChange={(x) => set("madeHere", x)}>
            <SelectTrigger id="it-made" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="yes">Yes — made in this factory</SelectItem><SelectItem value="no">No — sourced by them</SelectItem><SelectItem value="unknown">Unknown</SelectItem></SelectContent>
          </Select>
        </FieldRow>
        <FieldRow label="Product link (optional)" htmlFor="it-prod">
          <Select value={v.productId || NONE} onValueChange={(x) => set("productId", x === NONE ? "" : x)}>
            <SelectTrigger id="it-prod" className="w-full"><SelectValue placeholder="—" /></SelectTrigger>
            <SelectContent><SelectItem value={NONE}>—</SelectItem>{products.map((p) => <SelectItem key={p.id} value={p.id}><span className="font-mono text-xs">{p.ref}</span> {p.name}</SelectItem>)}</SelectContent>
          </Select>
        </FieldRow>
      </div>
      <FieldRow label="Note (optional)" htmlFor="it-note" hint="Client-visible — leak-checked on publish"><Textarea id="it-note" rows={2} value={v.note} onChange={(e) => set("note", e.target.value)} /></FieldRow>
      {errors._ && <p className="text-xs text-danger" role="alert">{errors._}</p>}
    </FormShell>
  );
}

/** DESIGN §5.16 — Publish to client: Filenames · Text · PDF text layer rows from a dry run, green Publish when all pass. */
function PublishRangeDialog({ r, open, onOpenChange, check, publish, unpublish }: { r: RangeDetail; open: boolean; onOpenChange: (o: boolean) => void; check: Actions["check"]; publish: Actions["publish"]; unpublish: Actions["unpublish"] }) {
  const router = useRouter();
  const [report, setReport] = React.useState<RangeLeakReport | null>(null);
  const [checking, setChecking] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [prevOpen, setPrevOpen] = React.useState(open);
  if (open !== prevOpen) { setPrevOpen(open); if (open && !r.publishedAt) { setReport(null); setChecking(true); } }
  React.useEffect(() => {
    // the dry run is an external call; its result lands via the promise callback
    if (!open || r.publishedAt) return;
    let cancelled = false;
    check({ rangeId: r.id }).then((res) => { if (cancelled) return; setChecking(false); if (res.ok) setReport(res.data); else toast.error(res.error); });
    return () => { cancelled = true; };
  }, [open, r.id, r.publishedAt, check]);
  if (r.publishedAt) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Unpublish from {r.orgName}</DialogTitle><DialogDescription>The range disappears from the client&apos;s catalog and the PDF copy stops being served. The label {r.label} is kept and never reused.</DialogDescription></DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button variant="destructive" disabled={pending} data-testid="confirm-unpublish-range" onClick={async () => { setPending(true); const res = await unpublish({ rangeId: r.id, rangeRef: r.ref }); setPending(false); if (res.ok) { toast.success("Range unpublished"); onOpenChange(false); router.refresh(); } else toast.error(res.error); }}>{pending && <Loader2 className="animate-spin" />}Unpublish</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }
  const hitsWhere = (pred: (w: string) => boolean) => report?.hits.filter((h) => pred(h.where)) ?? [];
  const rows = [
    { label: "Filenames", hits: hitsWhere((w) => w === "filename"), meta: `${report?.checked.filenames ?? 0} files` },
    { label: "Item names and notes", hits: hitsWhere((w) => w.startsWith("item ")), meta: `${report?.checked.items ?? r.items.length} items` },
    { label: "PDF text layer", hits: hitsWhere((w) => w === "pdf_text"), meta: r.pdfSource ? `${report?.checked.pdfChars ?? 0} characters extracted` : "no PDF" },
  ];
  const ok = !!report && report.ok && r.items.length > 0;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="publish-range-dialog">
        <DialogHeader><DialogTitle>Publish to client</DialogTitle><DialogDescription>{r.orgName} will see this range as <strong>Factory {r.label ?? "F-nnnn (next in sequence)"}</strong> — {r.items.length} items{r.pdfSource ? " and the PDF" : ""}. The supplier name never travels.</DialogDescription></DialogHeader>
        {checking ? <p className="flex items-center gap-2 py-4 text-sm text-ink-2"><Loader2 className="size-4 animate-spin" />Running the leak check…</p> : (
          <ul className="divide-y divide-hairline-faint" data-testid="range-check-rows">
            {rows.map((row) => (
              <li key={row.label} className="flex items-start gap-2 py-2 text-sm" data-ok={report ? row.hits.length === 0 : undefined}>
                <span className={cn("mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full", !report ? "bg-neutral-wash text-neutral" : row.hits.length ? "bg-danger-wash text-danger" : "bg-success-wash text-success")}>{!report ? <span className="size-1.5 rounded-full bg-current" /> : row.hits.length ? <X className="size-3" /> : <Check className="size-3" />}</span>
                <span className="flex-1"><span className="font-medium">{row.label}</span><span className="ml-2 text-xs text-muted-foreground">{row.meta}</span>
                  {row.hits.length > 0 && <span className="mt-1 flex flex-col gap-0.5">{row.hits.map((h, i) => <code key={i} className="w-fit rounded bg-danger-wash px-1.5 py-0.5 font-mono text-xs text-danger">{h.kind} · “{h.match}” in {h.where}</code>)}</span>}
                </span>
              </li>
            ))}
            {r.items.length === 0 && <li className="py-2 text-sm text-danger">Add at least one item.</li>}
          </ul>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          {report && !report.ok ? <Button disabled data-testid="fix-and-retry">Fix and try again</Button> : (
            <Button variant="green" disabled={!ok || pending} data-testid="confirm-publish-range" onClick={async () => {
              setPending(true);
              const res = await publish({ rangeId: r.id, rangeRef: r.ref });
              setPending(false);
              if (!res.ok) { if (res.hits) setReport({ ok: false, hits: res.hits, checked: report?.checked ?? { items: r.items.length, filenames: 0, pdfChars: 0 } }); toast.error(res.error === "E_LEAK_CHECK" ? "Blocked by the leak check" : res.error); router.refresh(); return; }
              toast.success(`Published to ${r.orgName} as Factory ${res.data.label}`); onOpenChange(false); router.refresh();
            }}><ShieldCheck data-icon="inline-start" />{pending && <Loader2 className="animate-spin" />}Publish</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


/** Client-facing catalogue name ("Oil filters", "Steel shelving"): what the client sees instead of "Factory F-0042". */
function CatalogueName({ r, rename }: { r: RangeDetail; rename: Actions["rename"] }) {
  const router = useRouter();
  const [value, setValue] = React.useState(r.displayName ?? "");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const dirty = value.trim() !== (r.displayName ?? "");
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    const res = await rename({ rangeId: r.id, rangeRef: r.ref, displayName: value });
    setBusy(false);
    if (res.ok) { toast.success(value.trim() ? "Catalogue name saved" : "Catalogue name removed"); router.refresh(); return; }
    setError(res.error === "E_LEAK_CHECK" ? "Looks like a supplier identifier — use a product category instead (e.g. “Oil filters”)." : res.errors?.displayName ?? "Could not save");
  };
  return (
    <form onSubmit={save} className="mt-2 flex flex-col gap-1.5 border-t border-hairline pt-3" data-testid="range-display-name">
      <label htmlFor="range-display-name" className="text-xs font-medium text-ink-2">Catalogue name (client sees this)</label>
      <div className="flex gap-2">
        <Input id="range-display-name" value={value} onChange={(e) => setValue(e.target.value)} placeholder="e.g. Oil filters" maxLength={80} className="h-9" aria-invalid={error ? true : undefined} />
        <Button type="submit" size="sm" variant="outline" className="h-9" disabled={!dirty || busy}>{busy ? <Loader2 className="animate-spin" /> : "Save"}</Button>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : <p className="text-xs text-muted-foreground">A product category, never a company or brand name. Leak-checked on save.</p>}
    </form>
  );
}
