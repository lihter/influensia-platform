"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table";
import { DateTime, Pct } from "@/components/shared/formatters";
import { EmptyState } from "@/components/shared/empty-state";
import { FormShell } from "@/components/shared/form-shell";
import { TextField, SelectField, DefRow } from "@/components/ops/clients/fields";
import { TIMEZONE_OPTIONS, INCOTERM_OPTIONS } from "@/components/ops/clients/strings";
import type { ActionResult } from "@/server/shared/http";
import type { AgencySettings, PricingRuleRow, FxRateRow, AgencyProfileInput, PricingRuleInput } from "@/server/ops/settings";
import { formatUnitPrice } from "@/server/shared/money";

const T = { E_FORBIDDEN: "Admin only", E_VALIDATION: "Check the highlighted fields", E_INTERNAL: "Something went wrong", E_NOT_FOUND: "Not found", E_UNAUTHORIZED: "Sign in again" } as Record<string, string>;
const err = (c: string) => T[c] ?? c;

export type SettingsActions = {
  profile: (input: AgencyProfileInput) => Promise<ActionResult<undefined>>;
  saveRule: (input: PricingRuleInput) => Promise<ActionResult<{ id: string; created: boolean }>>;
  deleteRule: (r: { id: string }) => Promise<ActionResult<undefined>>;
};

/** Agency profile card: admin form / agent definition rows. */
export function AgencyProfileCard({ s, admin, save }: { s: AgencySettings; admin: boolean; save: SettingsActions["profile"] }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  if (!admin) {
    return (
      <div className="sheet">
        <dl className="divide-y divide-hairline-faint">
          <DefRow label="Agency name">{s.org.name}</DefRow>
          <DefRow label="Country" mono>{s.org.country}</DefRow>
          <DefRow label="Timezone" mono>{s.org.timezone}</DefRow>
          <DefRow label="Default incoterm" mono>{s.org.defaultIncoterm}</DefRow>
          <DefRow label="Email sender">{s.emailSender}</DefRow>
        </dl>
      </div>
    );
  }
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(e.currentTarget).entries()) as Record<string, string>;
    setErrors({});
    start(async () => {
      const r = await save({ name: v.name, country: v.country, timezone: v.timezone, defaultIncoterm: v.defaultIncoterm });
      if (!r.ok) { setErrors(r.errors ?? {}); toast.error(err(r.error)); return; }
      toast.success("Agency profile saved");
      router.refresh();
    });
  };
  return (
    <form onSubmit={onSubmit} className="rounded-xl border border-border bg-card p-5" data-testid="agency-profile-form">
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField id="name" label="Agency name" defaultValue={s.org.name} error={errors.name} required />
        <TextField id="country" label="Country (ISO-2)" defaultValue={s.org.country ?? ""} error={errors.country} maxLength={2} className="[&_input]:font-mono [&_input]:uppercase" />
        <SelectField id="timezone" label="Timezone" options={TIMEZONE_OPTIONS.some((o) => o.value === s.org.timezone) ? TIMEZONE_OPTIONS : [{ value: s.org.timezone, label: s.org.timezone }, ...TIMEZONE_OPTIONS]} defaultValue={s.org.timezone} error={errors.timezone} />
        <SelectField id="defaultIncoterm" label="Default incoterm" options={INCOTERM_OPTIONS} defaultValue={s.org.defaultIncoterm} error={errors.defaultIncoterm} />
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <label className="text-xs font-medium text-ink-2" htmlFor="emailSender">Email sender</label>
          <Input id="emailSender" value={s.emailSender} readOnly disabled />
          <p className="text-xs text-muted-foreground">{s.localMode ? "Local mode — nothing is transmitted. Set EMAIL_FROM / RESEND_API_KEY in the environment to change the sender." : "Configured via EMAIL_FROM."}</p>
        </div>
      </div>
      <div className="mt-5 flex justify-end border-t border-hairline-faint pt-4">
        <Button type="submit" disabled={pending} data-testid="save-agency">{pending && <Loader2 className="animate-spin" />}Save profile</Button>
      </div>
    </form>
  );
}

const CATEGORY_OPTIONS = ["packaging", "fitness", "garden", "lighting", "safety", "seasonal", "furniture", "tools", "other", "default"].map((v) => ({ value: v, label: v }));

/** Pricing rules editor (admin): inline row edits + "+ Rule" sheet; agents see the table only. */
export function PricingRulesTable({ rules, admin, actions }: { rules: PricingRuleRow[]; admin: boolean; actions: Pick<SettingsActions, "saveRule" | "deleteRule"> }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [editing, setEditing] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<Record<string, string>>({});
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState<string | null>(null);

  const startEdit = (r: PricingRuleRow) => { setEditing(r.id); setDraft({ marginPct: String(r.marginPct), feePct: String(r.feePct), upliftPct: String(r.upliftPct), rounding: String(r.rounding) }); setErrors({}); };
  const commit = (r: PricingRuleRow) => {
    setBusy(r.id);
    start(async () => {
      const res = await actions.saveRule({ category: r.category as PricingRuleInput["category"], marginPct: draft.marginPct, feePct: draft.feePct, upliftPct: draft.upliftPct, rounding: draft.rounding });
      if (!res.ok) { setErrors(res.errors ?? {}); toast.error(err(res.error)); setBusy(null); return; }
      toast.success(`Rule ${r.category} saved — new offers only`);
      setEditing(null); setBusy(null);
      router.refresh();
    });
  };
  const remove = (r: PricingRuleRow) => {
    setBusy(r.id);
    start(async () => {
      const res = await actions.deleteRule({ id: r.id });
      if (res.ok) toast.success(`Rule ${r.category} removed`); else toast.error(err(res.error));
      setBusy(null);
      router.refresh();
    });
  };

  const num = (r: PricingRuleRow, k: "marginPct" | "feePct" | "upliftPct" | "rounding") =>
    editing === r.id ? (
      <Input
        type="number" step={k === "rounding" ? 1 : 0.5} min={0} max={k === "rounding" ? 6 : 100} value={draft[k] ?? ""} aria-invalid={errors[k] ? true : undefined} aria-label={`${r.category} ${k}`}
        onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(r); } if (e.key === "Escape") setEditing(null); }}
        className="h-7 w-20 text-right font-mono text-[13px]" data-testid={`rule-${r.category}-${k}`}
      />
    ) : k === "rounding" ? <span>{r[k]} dp</span> : <Pct pct={r[k]} />;

  const columns: DataTableColumn<PricingRuleRow>[] = [
    { id: "category", accessorKey: "category", header: "Category", meta: { sticky: true }, cell: ({ row }) => <span className={row.original.category === "default" ? "font-medium text-foreground" : "capitalize"}>{row.original.category}</span> },
    { id: "margin", accessorKey: "marginPct", header: "Margin", meta: { numeric: true, strong: true }, cell: ({ row }) => num(row.original, "marginPct") },
    { id: "fee", accessorKey: "feePct", header: "Fee", meta: { numeric: true }, cell: ({ row }) => num(row.original, "feePct") },
    { id: "uplift", accessorKey: "upliftPct", header: "Uplift", meta: { numeric: true }, cell: ({ row }) => num(row.original, "upliftPct") },
    { id: "rounding", accessorKey: "rounding", header: "Rounding", meta: { numeric: true }, cell: ({ row }) => num(row.original, "rounding") },
    { id: "example", header: "Factory $1.00 →", meta: { numeric: true }, enableSorting: false, cell: ({ row }) => <span className="text-xs">{formatUnitPrice({ minorE2: Math.round(10000 * (1 + row.original.marginPct / 100)), currency: "USD" })} all-in · +{formatUnitPrice({ minorE2: Math.round(10000 * (row.original.feePct / 100)), currency: "USD" })} fee</span> },
    { id: "updated", accessorKey: "updatedAt", header: "Updated", meta: { numeric: true }, cell: ({ row }) => <DateTime value={row.original.updatedAt} variant="short" /> },
  ];
  if (admin) {
    columns.push({
      id: "actions", header: "", meta: { numeric: true, width: "11rem" }, enableSorting: false,
      cell: ({ row }) => {
        const r = row.original;
        const isBusy = pending && busy === r.id;
        return editing === r.id ? (
          <span className="inline-flex gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => setEditing(null)} disabled={isBusy}>Cancel</Button>
            <Button size="sm" onClick={() => commit(r)} disabled={isBusy} data-testid={`rule-${r.category}-save`}>{isBusy && <Loader2 className="animate-spin" />}Save</Button>
          </span>
        ) : (
          <span className="inline-flex gap-1.5">
            <Button size="sm" variant="outline" onClick={() => startEdit(r)} data-testid={`rule-${r.category}-edit`}>Edit</Button>
            {r.category !== "default" && <Button size="icon-sm" variant="ghost" aria-label={`Remove ${r.category}`} onClick={() => remove(r)} disabled={isBusy}><Trash2 /></Button>}
          </span>
        );
      },
    });
  }

  const existing = new Set(rules.map((r) => r.category));
  const addable = CATEGORY_OPTIONS.filter((o) => !existing.has(o.value));
  const [addErrors, setAddErrors] = React.useState<Record<string, string>>({});
  const onAdd = async (e: React.FormEvent<HTMLFormElement>) => {
    const v = Object.fromEntries(new FormData(e.currentTarget).entries()) as Record<string, string>;
    setAddErrors({});
    const res = await actions.saveRule({ category: v.category as PricingRuleInput["category"], marginPct: v.marginPct, feePct: v.feePct, upliftPct: v.upliftPct, rounding: v.rounding });
    if (!res.ok) { setAddErrors(res.errors ?? {}); toast.error(err(res.error)); return false; }
    toast.success(`Rule ${v.category} added`);
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-ink-2">Margin (all-in display), fee (factory + fee display) and uplift (internal target buffer) by product category. Changes affect new offers only; <span className="font-medium text-foreground">default</span> is the fallback.</p>
        {admin && addable.length > 0 && (
          <FormShell trigger={<Button variant="outline" data-testid="add-rule"><Plus />Rule</Button>} eyebrow="Pricing rules" title="New pricing rule" submitLabel="Add rule" onSubmit={onAdd}>
            <SelectField id="category" label="Category" options={addable} error={addErrors.category} />
            <div className="grid grid-cols-2 gap-4">
              <TextField id="marginPct" label="Margin %" type="number" step={0.5} min={0} max={100} defaultValue={15} error={addErrors.marginPct} className="[&_input]:font-mono [&_input]:text-right" />
              <TextField id="feePct" label="Fee %" type="number" step={0.5} min={0} max={100} defaultValue={10} error={addErrors.feePct} className="[&_input]:font-mono [&_input]:text-right" />
              <TextField id="upliftPct" label="Uplift %" type="number" step={0.5} min={0} max={100} defaultValue={20} error={addErrors.upliftPct} className="[&_input]:font-mono [&_input]:text-right" />
              <TextField id="rounding" label="Rounding (dp)" type="number" step={1} min={0} max={6} defaultValue={2} error={addErrors.rounding} className="[&_input]:font-mono [&_input]:text-right" />
            </div>
          </FormShell>
        )}
      </div>
      <DataTable columns={columns} data={rules} density="compact" data-testid="pricing-rules" emptyState={<EmptyState title="No pricing rules" className="py-8" />} />
    </div>
  );
}

export function FxRatesTable({ rates }: { rates: FxRateRow[] }) {
  const columns: DataTableColumn<FxRateRow>[] = [
    { id: "date", accessorKey: "date", header: "Date", meta: { sticky: true }, cell: ({ row }) => <DateTime value={row.original.date} /> },
    { id: "pair", accessorFn: (r) => `${r.base}/${r.quote}`, header: "Pair", cell: ({ row }) => <span className="font-mono text-[13px]">{row.original.base}/{row.original.quote}</span> },
    { id: "rate", accessorKey: "rate", header: "Rate", meta: { numeric: true, strong: true }, cell: ({ row }) => row.original.rate.toFixed(4) },
    { id: "source", accessorKey: "source", header: "Source", cell: ({ row }) => row.original.source ?? <span className="text-faint">—</span> },
  ];
  return <DataTable columns={columns} data={rates} density="compact" data-testid="fx-rates" initialSorting={[{ id: "date", desc: true }]} emptyState={<EmptyState title="No FX rates" className="py-8" />} />;
}
