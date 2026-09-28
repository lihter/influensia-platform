"use client";
import * as React from "react";
import { ExternalLink, Trash2, EyeOff, Upload, Check, X } from "lucide-react";
import type { OpsLine } from "@/server/ops/participations";
import { specCompleteness } from "./pure";
import { PRODUCT_CATEGORIES, UNITS } from "@/db/enums";
import { formatQty } from "@/server/shared/money";
import { fmtDate as formatDate } from "@/lib/format-date";
import { label, specKeyLabel, specValueLabel, SPEC_KEY_LABELS } from "@/lib/labels";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { UtilityBadge } from "@/components/shared/chips";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { saveSpecAction, freezeSpecAction, uploadSupplierImageAction } from "@/app/(ops)/ops/lines/[ref]/actions";
import { S } from "./strings";
import { useAction } from "./use-action";

type Row = { key: string; value: string };

function Card({ title, children, action, className }: { title: React.ReactNode; children: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-xl border border-border bg-card p-5", className)}>
      <div className="mb-4 flex items-center justify-between gap-3"><h2 className="text-base font-semibold">{title}</h2>{action}</div>
      {children}
    </section>
  );
}
function Def({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex items-start justify-between gap-4 border-b border-hairline-faint py-2 text-sm last:border-b-0"><dt className="shrink-0 text-xs text-muted-foreground">{label}</dt><dd className="text-right text-foreground">{children}</dd></div>;
}

export function SpecTab({ line }: { line: OpsLine }) {
  const { run, pending, errors } = useAction();
  const src = line.draftSpec ?? line.specs[0] ?? null;
  const [productName, setProductName] = React.useState(line.product?.name ?? line.name);
  const [category, setCategory] = React.useState(line.product?.category ?? "");
  const [hsCode, setHsCode] = React.useState(line.product?.hsCode ?? "");
  const [unit, setUnit] = React.useState(line.unit);
  const [materials, setMaterials] = React.useState(line.materials ?? "");
  const [customisation, setCustomisation] = React.useState(line.customisation ?? "");
  const [artworkRequired, setArtwork] = React.useState(line.artworkRequired);
  const [sampleRequired, setSample] = React.useState(line.sampleRequired);
  const [rows, setRows] = React.useState<Row[]>(src ? Object.entries(src.fields).map(([k, v]) => ({ key: k, value: String(v) })) : [{ key: "", value: "" }]);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = React.useState(false);

  const fields = rows.filter((r) => r.key.trim()).map((r) => ({ key: r.key.trim(), value: r.value === "true" ? true : r.value === "false" ? false : r.value.trim() }));
  const imageCount = (line.product?.images.length ?? 0) + line.referenceImages.length;
  const gate = specCompleteness({ name: productName, category: category || null, unit, fieldCount: fields.length, imageCount, linkCount: line.links.length, qty: line.qty });
  const nextVersion = (line.specs[0]?.version ?? 0) + 1;
  const payload = () => ({ lineId: line.id, productName, category: (category || null) as never, hsCode: hsCode || null, unit: unit as never, materials: materials || null, customisation: customisation || null, artworkRequired, sampleRequired, fields });
  const setRow = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const upload = async (file: File, kind: "supplier_facing" | "clean") => {
    setUploading(true);
    const fd = new FormData(); fd.set("lineId", line.id); fd.set("kind", kind); fd.set("file", file);
    await run(() => uploadSupplierImageAction(fd), { success: "Image uploaded" });
    setUploading(false);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]" data-testid="spec-tab">
      <div className="flex flex-col gap-6">
        <Card title={S.spec.clientInput}>
          <dl>
            <Def label={S.spec.qty}>{line.qty ? formatQty(line.qty, line.unit) : "—"}</Def>
            <Def label={S.spec.sku}><span className="font-mono">{line.clientSku ?? "—"}</span></Def>
            <Def label={S.spec.delivery}>{line.request.targetDelivery ? formatDate(line.request.targetDelivery) : "—"}</Def>
            <Def label={S.spec.destination}>{line.request.destination ?? "—"}</Def>
            <Def label={S.spec.incotermWanted}>{line.request.incotermWanted ?? line.org.defaultIncoterm}</Def>
            <Def label={S.spec.forecast}>{line.volume12m ? formatQty(line.volume12m, line.unit) : "—"}</Def>
            <Def label={S.spec.note}>{line.request.note ?? line.customisation ?? "—"}</Def>
          </dl>
          <div className="mt-4">
            <div className="eyebrow mb-2">{S.spec.links}</div>
            {line.links.length === 0 ? <p className="text-xs text-muted-foreground">—</p> : (
              <ul className="sheet">
                {line.links.map((l) => (
                  <li key={l.url} className="sheet-row flex items-center gap-2 text-sm">
                    <a href={l.url} target="_blank" rel="noreferrer noopener" className="link min-w-0 flex-1 truncate">{l.url}</a>
                    {l.notDurable && <UtilityBadge kind="draft">{S.spec.notDurable}</UtilityBadge>}
                    <ExternalLink className="size-3.5 text-muted-foreground" />
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="mt-4">
            <div className="eyebrow mb-2">{S.spec.referenceImages}</div>
            {line.referenceImages.length === 0 ? <p className="text-xs text-muted-foreground">{S.spec.noReference}</p> : (
              <div className="flex flex-wrap gap-3">
                {line.referenceImages.map((d) => (
                  <figure key={d.id} className="w-24" data-testid="reference-image">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={d.href} alt={d.filename} className="aspect-square w-24 rounded-md border border-border bg-section-alt object-cover" />
                    <figcaption className="mt-1 flex items-center gap-1 text-2xs text-warning"><EyeOff className="size-3" />{S.spec.referenceHint}</figcaption>
                  </figure>
                ))}
              </div>
            )}
          </div>
        </Card>
        <Card title={S.spec.supplierImages} action={<Button size="sm" variant="outline" type="button" disabled={uploading} onClick={() => fileRef.current?.click()}><Upload data-icon="inline-start" />{S.spec.upload}</Button>}>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" data-testid="supplier-image-input" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f, "supplier_facing"); e.target.value = ""; }} />
          <p className="mb-3 text-xs text-muted-foreground">{S.spec.supplierHint}</p>
          {(line.product?.images.length ?? 0) === 0 ? <p className="text-xs text-muted-foreground">—</p> : (
            <div className="flex flex-wrap gap-3">
              {line.product!.images.map((i) => (
                <figure key={i.id} className="w-24" data-kind={i.kind}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={i.href} alt={i.kind} className="aspect-square w-24 rounded-md border border-border bg-section-alt object-cover" />
                  <figcaption className="mt-1"><UtilityBadge kind={i.kind === "clean" ? "recommended" : i.kind === "supplier_facing" ? "draft" : "range"}>{label("imageKind", i.kind)}</UtilityBadge></figcaption>
                </figure>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="flex flex-col gap-6">
        <Card title={S.spec.form} action={line.specVersion ? <UtilityBadge kind="version">v{line.specVersion} frozen</UtilityBadge> : null}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5 sm:col-span-2"><Label htmlFor="sp-name">{S.spec.productName}</Label><Input id="sp-name" value={productName} onChange={(e) => setProductName(e.target.value)} /></div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sp-cat">{S.spec.category}</Label>
              <NativeSelect id="sp-cat" value={category} onChange={(e) => setCategory(e.target.value)} data-testid="spec-category">
                <option value="">Choose…</option>{PRODUCT_CATEGORIES.map((c) => <option key={c} value={c}>{label("productCategory", c)}</option>)}
              </NativeSelect>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sp-unit">{S.spec.unit}</Label>
              <NativeSelect id="sp-unit" value={unit} onChange={(e) => setUnit(e.target.value)} data-testid="spec-unit">{UNITS.map((u) => <option key={u} value={u}>{label("unit", u)}</option>)}</NativeSelect>
            </div>
            <div className="flex flex-col gap-1.5"><Label htmlFor="sp-hs">HS code <span className="font-normal text-muted-foreground">(optional)</span></Label><Input id="sp-hs" value={hsCode} onChange={(e) => setHsCode(e.target.value)} className="font-mono" inputMode="numeric" placeholder="e.g. 392690" aria-describedby="sp-hs-hint" /><p id="sp-hs-hint" className="text-xs text-muted-foreground">6–10 digits</p></div>
            <div className="flex flex-col gap-1.5"><Label htmlFor="sp-mat">{S.spec.materials}</Label><Input id="sp-mat" value={materials} onChange={(e) => setMaterials(e.target.value)} /></div>
            <div className="flex flex-col gap-1.5 sm:col-span-2"><Label htmlFor="sp-cust">{S.spec.customisation}</Label><Textarea id="sp-cust" rows={2} value={customisation} onChange={(e) => setCustomisation(e.target.value)} /></div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-green-600" checked={artworkRequired} onChange={(e) => setArtwork(e.target.checked)} />{S.spec.artwork}</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-green-600" checked={sampleRequired} onChange={(e) => setSample(e.target.checked)} />{S.spec.sample}</label>
          </div>
          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between"><Label>{S.spec.fields}</Label><Button type="button" size="sm" variant="ghost" onClick={() => setRows((r) => [...r, { key: "", value: "" }])}>{S.spec.addField}</Button></div>
            <div className="sheet" data-testid="spec-fields">
              <div className="grid grid-cols-[1fr_1.4fr_2rem] gap-2 bg-section-alt px-3 py-1.5 text-2xs font-semibold uppercase tracking-[0.06em] text-muted-foreground"><span>{S.spec.key}</span><span>{S.spec.value}</span><span /></div>
              <datalist id="spec-key-options">{Object.entries(SPEC_KEY_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</datalist>
              {rows.map((r, i) => {
                const isBool = r.value === "true" || r.value === "false";
                return (
                  <div key={i} className="grid grid-cols-[1fr_1.4fr_2rem] items-center gap-2 px-3 py-1.5">
                    <div className="min-w-0">
                      <Input value={r.key} placeholder="e.g. size" list="spec-key-options" onChange={(e) => setRow(i, { key: e.target.value })} className="h-8 font-mono text-xs" data-testid="spec-key" aria-label="Field key" />
                      {r.key.trim() && <p className="mt-0.5 truncate text-2xs text-muted-foreground" title="What the client reads">Shown as “{specKeyLabel(r.key.trim())}”</p>}
                    </div>
                    {isBool ? (
                      <label className="inline-flex h-8 items-center gap-2 text-sm" data-testid="spec-value">
                        <input type="checkbox" className="size-4 accent-green-600" checked={r.value === "true"} onChange={(e) => setRow(i, { value: e.target.checked ? "true" : "false" })} />
                        {r.value === "true" ? "Yes" : "No"}
                      </label>
                    ) : (
                      <Input value={r.value} placeholder="e.g. 66×91 mm" onChange={(e) => setRow(i, { value: e.target.value })} className="h-8" data-testid="spec-value" aria-label="Field value" />
                    )}
                    <Button type="button" size="icon-xs" variant="ghost" aria-label="Remove field" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}><Trash2 /></Button>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="mt-5 rounded-lg bg-section-alt px-4 py-3" data-testid="completeness">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">{S.spec.completeness}</span>
              <span className={cn("inline-flex items-center gap-1 text-xs", gate.ok ? "text-success" : "text-warning")}>{gate.ok ? <Check className="size-3.5" /> : <X className="size-3.5" />}{gate.ok ? S.spec.ready : `${S.spec.missing}: ${gate.missing.join(", ")}`}</span>
            </div>
          </div>
          {errors._ && <p className="mt-2 text-xs text-danger">{errors._}</p>}
          {line.specVersion && <p className="mt-2 text-xs text-muted-foreground">{S.spec.lockedHint.replace("{n}", String(nextVersion))}</p>}
          <div className="mt-4 flex items-center justify-end gap-2">
            <Button type="button" variant="outline" disabled={pending} onClick={() => run(() => saveSpecAction(payload()), { success: "Spec draft saved" })}>{S.spec.save}</Button>
            <Dialog>
              <DialogTrigger asChild><Button type="button" disabled={!gate.ok || pending} data-testid="freeze-spec">{S.spec.freeze(nextVersion)}</Button></DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader><DialogTitle>{S.spec.freeze(nextVersion)}</DialogTitle><DialogDescription>Freezing locks the client&apos;s edits and posts &quot;Spec confirmed&quot; to their timeline.</DialogDescription></DialogHeader>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">{fields.map((f) => <React.Fragment key={f.key}><dt className="text-muted-foreground">{specKeyLabel(f.key)}</dt><dd className="text-foreground">{specValueLabel(f.value)}</dd></React.Fragment>)}</dl>
                <DialogFooter>
                  <Button type="button" disabled={pending} data-testid="freeze-confirm" onClick={() => run(() => freezeSpecAction(payload()), { success: (d) => `Spec v${d.version} frozen` })}>{S.common.confirm}</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </Card>
        <Card title={S.spec.frozenVersions}>
          {line.specs.length === 0 ? <p className="text-xs text-muted-foreground">{S.spec.noneFrozen}</p> : (
            <ul className="sheet" data-testid="spec-versions">
              {line.specs.map((s) => (
                <li key={s.id} className="sheet-row text-sm">
                  <div className="flex items-center gap-2"><UtilityBadge kind="version">v{s.version}</UtilityBadge><span className="text-xs text-muted-foreground"><span className="font-mono">{formatDate(s.frozenAt)}</span> · {s.frozenByName ?? "—"}</span></div>
                  <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-xs">{Object.entries(s.fields).map(([k, v]) => <React.Fragment key={k}><dt className="text-muted-foreground">{specKeyLabel(k)}</dt><dd>{specValueLabel(v)}</dd></React.Fragment>)}</dl>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
