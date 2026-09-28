"use client";
import * as React from "react";
import type { OpsLine } from "@/server/ops/participations";
import { formatUnitPrice } from "@/server/shared/money";
import { formatDate } from "@/server/shared/dates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { VisibilityBadge } from "@/components/shared/chips";
import { saveCostModelAction, confirmTargetAction } from "@/app/(ops)/ops/lines/[ref]/actions";
import { S } from "./strings";
import { useAction } from "./use-action";
import { targetPriceE2, defaultEstE2, parsePriceE2, e2ToText } from "./pure";

function PriceInput({ id, label, value, onChange, hint }: { id: string; label: string; value: string; onChange: (v: string) => void; hint?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center font-mono text-sm text-muted-foreground">$</span>
        <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} inputMode="decimal" className="pl-7 text-right font-mono" placeholder="0.0000" />
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** SPEC F-16 — cost model card + target card; pricing-rule hint; confirm target. */
export function CostTab({ line }: { line: OpsLine }) {
  const { run, pending, errors } = useAction();
  const cm = line.costModel;
  const [material, setMaterial] = React.useState(e2ToText(cm?.material_floor_minor_e2));
  const [process, setProcess] = React.useState(e2ToText(cm?.process_cost_minor_e2));
  const [packaging, setPackaging] = React.useState(e2ToText(cm?.packaging_minor_e2));
  const [overhead, setOverhead] = React.useState(String(cm?.overhead_pct ?? 10));
  const [estText, setEstText] = React.useState(e2ToText(cm?.est_prod_cost_minor_e2));
  const [estTouched, setEstTouched] = React.useState(!!cm?.est_prod_cost_minor_e2);
  const [method, setMethod] = React.useState(cm?.method ?? "");
  const [notes, setNotes] = React.useState(cm?.notes ?? "");
  const [uplift, setUplift] = React.useState(String(line.upliftPct ?? line.pricingRule.upliftPct));

  const m = parsePriceE2(material) ?? 0, p = parsePriceE2(process) ?? 0, k = parsePriceE2(packaging) ?? 0;
  const oh = Number(overhead) || 0;
  const computedEst = defaultEstE2(m, p, k, oh);
  const est = estTouched ? estText : computedEst ? e2ToText(computedEst) : "";
  const estE2 = parsePriceE2(est) ?? 0;
  const upliftN = Number(uplift) || 0;
  // untouched form → show the stored target (AC-COST-01 `$0.037`); any edit → live computation
  const untouched = estE2 === (cm?.est_prod_cost_minor_e2 ?? 0) && upliftN === (line.upliftPct ?? line.pricingRule.upliftPct) && !!line.targetPriceMinorE2;
  const target = untouched ? line.targetPriceMinorE2 : estE2 > 0 ? targetPriceE2(estE2, upliftN) : null;
  const marginVsTarget = target && estE2 ? ((target - estE2) / target) * 100 : null;

  const save = () => run(() => saveCostModelAction({ lineId: line.id, materialFloorMinorE2: m || null, processCostMinorE2: p || null, packagingMinorE2: k || null, overheadPct: oh, estProdCostMinorE2: estE2, method: method || null, notes: notes || null, upliftPct: upliftN }), { success: (d) => `Target ${formatUnitPrice({ minorE2: d.targetPriceMinorE2, currency: "USD" })}` });

  return (
    <div className="grid gap-6 lg:grid-cols-2" data-testid="cost-tab">
      <section className="rounded-xl border border-border bg-card p-5">
        <div className="mb-4 flex items-center justify-between"><h2 className="text-base font-semibold">{S.cost.title}</h2><VisibilityBadge visibility="internal" /></div>
        <div className="grid gap-4 sm:grid-cols-2">
          <PriceInput id="c-mat" label={S.cost.material} value={material} onChange={setMaterial} />
          <PriceInput id="c-proc" label={S.cost.process} value={process} onChange={setProcess} />
          <PriceInput id="c-pack" label={S.cost.packaging} value={packaging} onChange={setPackaging} />
          <div className="flex flex-col gap-1.5"><Label htmlFor="c-oh">{S.cost.overhead}</Label><Input id="c-oh" value={overhead} onChange={(e) => setOverhead(e.target.value)} inputMode="decimal" className="text-right font-mono" /></div>
          <div className="sm:col-span-2"><PriceInput id="c-est" label={S.cost.est} value={est} onChange={(v) => { setEstText(v); setEstTouched(true); }} hint={S.cost.estHint} /></div>
          {errors.estProdCostMinorE2 && <p className="text-xs text-danger sm:col-span-2">{errors.estProdCostMinorE2}</p>}
          <div className="flex flex-col gap-1.5 sm:col-span-2"><Label htmlFor="c-method">{S.cost.method}</Label><Input id="c-method" value={method} onChange={(e) => setMethod(e.target.value)} placeholder="e.g. mass × resin price" /></div>
          <div className="flex flex-col gap-1.5 sm:col-span-2"><Label htmlFor="c-notes">{S.cost.notes}</Label><Textarea id="c-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
        </div>
        <div className="mt-5 flex items-baseline justify-between rounded-lg bg-section-alt px-4 py-3">
          <span className="text-sm text-ink-2">{S.cost.est}</span>
          <span className="font-mono text-xl font-semibold tracking-[-0.01em] text-foreground" data-testid="est-cost">{estE2 ? formatUnitPrice({ minorE2: estE2, currency: "USD" }, { decimals: 4 }) : "—"}<span className="ml-1 text-sm font-normal text-muted-foreground">/ {line.unit}</span></span>
        </div>
        {line.state === "spec_frozen" && <p className="mt-3 text-xs text-muted-foreground">{S.cost.firstSave}</p>}
        <div className="mt-4 flex justify-end"><Button type="button" disabled={pending || !estE2} onClick={save} data-testid="save-cost">{S.cost.save}</Button></div>
      </section>

      <section className="rounded-xl border border-border bg-card p-5">
        <div className="mb-4"><h2 className="text-base font-semibold">{S.cost.target}</h2><p className="font-mono text-2xs text-muted-foreground">{S.cost.ruleHint(line.pricingRule.category, line.pricingRule.upliftPct, line.pricingRule.marginPct)}</p></div>
        <div className="flex flex-col gap-1.5"><Label htmlFor="c-uplift">{S.cost.uplift}</Label><Input id="c-uplift" value={uplift} onChange={(e) => setUplift(e.target.value)} inputMode="decimal" className="w-32 text-right font-mono" data-testid="uplift" /></div>
        <div className="mt-5 rounded-lg bg-section-alt px-4 py-4">
          <div className="eyebrow">{S.cost.targetPrice}</div>
          <div className="mt-1 font-mono text-[1.75rem] font-semibold tracking-[-0.02em]" data-testid="target-price">{target ? formatUnitPrice({ minorE2: target, currency: "USD" }) : "—"}<span className="ml-1 text-sm font-normal text-muted-foreground">/ {line.unit}</span></div>
          {marginVsTarget !== null && <div className="mt-1 text-xs text-muted-foreground">margin readout {marginVsTarget.toFixed(1)} % of target · +{upliftN} % over cost</div>}
          {line.targetPriceMinorE2 && target !== line.targetPriceMinorE2 && <div className="mt-1 text-xs text-warning">stored: {formatUnitPrice({ minorE2: line.targetPriceMinorE2, currency: "USD" }, { decimals: 4 })} — save to update</div>}
        </div>
        <div className="mt-4 text-sm" data-testid="target-confirmed">
          {line.targetConfirmed ? <span className="text-success">{S.cost.confirmed(line.targetConfirmed.byName ?? "—", formatDate(line.targetConfirmed.at))}</span> : <span className="text-muted-foreground">{line.targetPriceMinorE2 ? S.cost.notConfirmed : S.cost.noTarget}</span>}
        </div>
        <div className="mt-4 flex justify-end">
          <Button type="button" variant={line.targetConfirmed ? "ghost" : "outline"} disabled={pending || !line.targetPriceMinorE2} onClick={() => run(() => confirmTargetAction({ lineId: line.id }), { success: "Target confirmed" })} data-testid="confirm-target">{line.targetConfirmed ? "Re-confirm" : S.cost.confirm}</Button>
        </div>
        <p className="mt-4 text-xs text-muted-foreground">{S.cost.internal}</p>
      </section>
    </div>
  );
}
