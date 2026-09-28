"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { ActionResult } from "@/server/shared/http";
import type { ProductFormInput } from "@/app/(ops)/ops/products/actions";
import { PRODUCT_CATEGORIES } from "@/db/enums";
import { FormShell } from "@/components/shared/form-shell";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FieldRow } from "@/components/ops/suppliers/supplier-form";

const NONE = "__none__";

/** "+ Product" sheet: name, category, unit, owner org, description, HS code. Reference price is set on the product page. */
export function ProductCreateForm({ owners, trigger, action }: { owners: { id: string; name: string }[]; trigger: React.ReactNode; action: (i: ProductFormInput) => Promise<ActionResult<{ id: string; ref: string }>> }) {
  const router = useRouter();
  const [v, setV] = React.useState({ name: "", category: "", unit: "pcs", ownerOrgId: "", description: "", hsCode: "" });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const set = (k: keyof typeof v, val: string) => setV((s) => ({ ...s, [k]: val }));
  return (
    <FormShell trigger={trigger} eyebrow="Products · new" title="New product" submitLabel="Create product"
      onSubmit={async () => {
        setErrors({});
        const r = await action({ name: v.name, category: (v.category || "") as never, unit: v.unit || "pcs", ownerOrgId: v.ownerOrgId || "", description: v.description || null, hsCode: v.hsCode || null });
        if (!r.ok) { setErrors(r.errors ?? { _: r.error }); toast.error(r.errors ? "Check the highlighted fields" : r.error); return false; }
        toast.success(`Product ${r.data.ref} created`);
        router.push(`/ops/products/${r.data.ref}`);
        return true;
      }}>
      <FieldRow label="Name" htmlFor="p-name" error={errors.name}><Input id="p-name" value={v.name} onChange={(e) => set("name", e.target.value)} placeholder="Boltless steel shelving 5-tier 180×90×40 black" autoFocus aria-invalid={!!errors.name} /></FieldRow>
      <div className="grid grid-cols-2 gap-4">
        <FieldRow label="Category" htmlFor="p-cat">
          <Select value={v.category || NONE} onValueChange={(x) => set("category", x === NONE ? "" : x)}>
            <SelectTrigger id="p-cat" className="w-full"><SelectValue placeholder="—" /></SelectTrigger>
            <SelectContent><SelectItem value={NONE}>—</SelectItem>{PRODUCT_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
          </Select>
        </FieldRow>
        <FieldRow label="Unit" htmlFor="p-unit" error={errors.unit}><Input id="p-unit" value={v.unit} onChange={(e) => set("unit", e.target.value)} className="font-mono" placeholder="pcs · set · pair" /></FieldRow>
        <FieldRow label="Owner org (optional)" htmlFor="p-owner" hint="The client whose request created it">
          <Select value={v.ownerOrgId || NONE} onValueChange={(x) => set("ownerOrgId", x === NONE ? "" : x)}>
            <SelectTrigger id="p-owner" className="w-full"><SelectValue placeholder="—" /></SelectTrigger>
            <SelectContent><SelectItem value={NONE}>— (agency)</SelectItem>{owners.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}</SelectContent>
          </Select>
        </FieldRow>
        <FieldRow label="HS code (optional)" htmlFor="p-hs"><Input id="p-hs" value={v.hsCode} onChange={(e) => set("hsCode", e.target.value)} className="font-mono" placeholder="9403.20" /></FieldRow>
      </div>
      <FieldRow label="Description (optional)" htmlFor="p-desc" hint="Client-facing when published — no factory names"><Textarea id="p-desc" rows={4} value={v.description} onChange={(e) => set("description", e.target.value)} /></FieldRow>
      {errors._ && <p className="text-xs text-danger" role="alert">{errors._}</p>}
    </FormShell>
  );
}
