"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertCircle } from "lucide-react";
import type { ActionResult } from "@/server/shared/http";
import type { SupplierFormInput, ContactFormInput } from "@/app/(ops)/ops/suppliers/actions";
import { SUPPLIER_TYPE_VERDICTS, VERDICT_SOURCES, SUPPLIER_GRADES, CONTACT_CHANNELS, type SupplierTypeVerdict, type VerdictSource, type SupplierGrade, type ContactChannel } from "@/db/enums";
import { FormShell } from "@/components/shared/form-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { VERDICT_LABEL, SOURCE_LABEL, CHANNEL_LABEL, GRADE_HINT } from "./labels";

const PORTS = ["Shenzhen", "Ningbo", "Shanghai", "Qingdao", "Xiamen", "Guangzhou", "Tianjin", "Yiwu", "other"] as const;

export type SupplierFormValues = {
  legalName: string; cnName: string; typeVerdict: SupplierTypeVerdict; verdictSource: VerdictSource | ""; grade: SupplierGrade | ""; uscc: string; registeredAt: string; capital: string;
  city: string; province: string; country: string; ports: string[]; website: string; notes: string;
};
const EMPTY: SupplierFormValues = { legalName: "", cnName: "", typeVerdict: "unchecked", verdictSource: "", grade: "", uscc: "", registeredAt: "", capital: "", city: "", province: "", country: "CN", ports: [], website: "", notes: "" };

export function FieldRow({ label, htmlFor, error, hint, children, className }: { label: string; htmlFor?: string; error?: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <Label htmlFor={htmlFor} className="mb-1.5 block text-xs font-medium text-ink-2">{label}</Label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      {error && <p className="mt-1 flex items-center gap-1 text-xs text-danger" role="alert"><AlertCircle className="size-3" />{error}</p>}
    </div>
  );
}

const NONE = "__none__";

/**
 * "+ Supplier" / "Edit" sheet (DESIGN §5.9). Create mode also takes the first contact (channel + handle) so a row from the
 * sourcing sheet (Company · type · contact · platform) lands in one go. Duplicate → inline warning naming SUP-nnnn;
 * admins get "Create anyway".
 */
export function SupplierForm({ mode, initial, supplierId, isAdmin, trigger, onCreate, onUpdate, open, onOpenChange }: {
  mode: "create" | "edit";
  initial?: Partial<SupplierFormValues>;
  supplierId?: string;
  isAdmin: boolean;
  trigger?: React.ReactNode;
  onCreate?: (input: SupplierFormInput & { contact?: ContactFormInput | null; createAnyway?: boolean }) => Promise<ActionResult<{ id: string; ref: string }>>;
  onUpdate?: (input: { id: string } & SupplierFormInput) => Promise<ActionResult<{ ref: string }>>;
  open?: boolean;
  onOpenChange?: (o: boolean) => void;
}) {
  const router = useRouter();
  const [v, setV] = React.useState<SupplierFormValues>({ ...EMPTY, ...initial });
  const [contact, setContact] = React.useState<{ name: string; channel: ContactChannel; handle: string; phone: string }>({ name: "", channel: "alibaba", handle: "", phone: "" });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [dup, setDup] = React.useState<{ text: string; ref: string } | null>(null);
  const [pending, setPending] = React.useState(false);
  const set = <K extends keyof SupplierFormValues>(k: K, val: SupplierFormValues[K]) => setV((s) => ({ ...s, [k]: val }));

  // reset when the sheet (re)opens — "state from previous renders" pattern, no effect needed
  const [prevOpen, setPrevOpen] = React.useState(open);
  if (open !== prevOpen) { setPrevOpen(open); if (open) { setV({ ...EMPTY, ...initial }); setErrors({}); setDup(null); } }

  const payload = (): SupplierFormInput => ({
    legalName: v.legalName, cnName: v.cnName || null, typeVerdict: v.typeVerdict, verdictSource: v.verdictSource || null, grade: v.grade || null, uscc: v.uscc || "", registeredAt: v.registeredAt || "",
    capital: v.capital || null, city: v.city || null, province: v.province || null, country: v.country || "", ports: v.ports as never, website: v.website || null, notes: v.notes || null,
  });

  const submit = async (createAnyway = false) => {
    setPending(true); setErrors({}); setDup(null);
    try {
      if (mode === "create" && onCreate) {
        const r = await onCreate({ ...payload(), contact: contact.name || contact.handle ? { name: contact.name || null, channel: contact.channel, handle: contact.handle || null, phone: contact.phone || null, isPrimary: true } : null, createAnyway });
        if (!r.ok) {
          if (r.error === "E_DUPLICATE_SUPPLIER" && r.errors?.legalName) { const m = r.errors.legalName.match(/SUP-\d{4}/); setDup({ text: r.errors.legalName, ref: m?.[0] ?? "" }); }
          else { setErrors(r.errors ?? { _: r.error }); toast.error(r.errors ? "Check the highlighted fields" : r.error); }
          return false;
        }
        toast.success(`Supplier ${r.data.ref} created`);
        router.push(`/ops/suppliers/${r.data.ref}`);
        return true;
      }
      if (mode === "edit" && onUpdate && supplierId) {
        const r = await onUpdate({ id: supplierId, ...payload() });
        if (!r.ok) {
          if (r.error === "E_DUPLICATE_SUPPLIER" && r.errors?.legalName) { const m = r.errors.legalName.match(/SUP-\d{4}/); setDup({ text: r.errors.legalName, ref: m?.[0] ?? "" }); }
          else { setErrors(r.errors ?? { _: r.error }); toast.error(r.errors ? "Check the highlighted fields" : r.error); }
          return false;
        }
        toast.success("Supplier saved");
        router.refresh();
        return true;
      }
      return false;
    } finally { setPending(false); }
  };

  return (
    <FormShell
      trigger={trigger} open={open} onOpenChange={onOpenChange} pending={pending} wide
      eyebrow={mode === "create" ? "Suppliers · new" : "Edit supplier"} title={mode === "create" ? "New supplier" : "Edit supplier"}
      submitLabel={mode === "create" ? "Create supplier" : "Save"} onSubmit={() => submit(false)}
      footerExtra={dup && isAdmin && mode === "create" ? <Button type="button" variant="outline" onClick={() => submit(true)} disabled={pending} data-testid="create-anyway">Create anyway</Button> : null}
    >
      {dup && (
        <div className="flex items-start gap-2 rounded-lg border border-warning-border bg-warning-wash px-3 py-2 text-sm text-warning" role="alert" data-testid="duplicate-warning">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <span>{dup.text}{dup.ref && <> — <Link href={`/ops/suppliers/${dup.ref}`} className="link">open {dup.ref}</Link></>}. Change the name{isAdmin ? " or create anyway" : ""}.</span>
        </div>
      )}
      <FieldRow label="Legal name" htmlFor="legalName" error={errors.legalName}>
        <Input id="legalName" value={v.legalName} onChange={(e) => set("legalName", e.target.value)} placeholder="Dongguan … Co., Ltd." autoFocus={mode === "create"} aria-invalid={!!errors.legalName} />
      </FieldRow>
      <FieldRow label="中文名 (optional)" htmlFor="cnName" error={errors.cnName}>
        <Input id="cnName" value={v.cnName} onChange={(e) => set("cnName", e.target.value)} placeholder="…有限公司" />
      </FieldRow>
      <div className="grid grid-cols-2 gap-4">
        <FieldRow label="Type verdict" htmlFor="typeVerdict">
          <Select value={v.typeVerdict} onValueChange={(x) => set("typeVerdict", x as SupplierTypeVerdict)}>
            <SelectTrigger id="typeVerdict" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>{SUPPLIER_TYPE_VERDICTS.map((x) => <SelectItem key={x} value={x}>{VERDICT_LABEL[x]}</SelectItem>)}</SelectContent>
          </Select>
        </FieldRow>
        <FieldRow label="Verdict source (optional)" htmlFor="verdictSource">
          <Select value={v.verdictSource || NONE} onValueChange={(x) => set("verdictSource", x === NONE ? "" : (x as VerdictSource))}>
            <SelectTrigger id="verdictSource" className="w-full"><SelectValue placeholder="—" /></SelectTrigger>
            <SelectContent><SelectItem value={NONE}>—</SelectItem>{VERDICT_SOURCES.map((x) => <SelectItem key={x} value={x}>{SOURCE_LABEL[x]}</SelectItem>)}</SelectContent>
          </Select>
        </FieldRow>
        <FieldRow label="Grade (optional)" htmlFor="grade">
          <Select value={v.grade || NONE} onValueChange={(x) => set("grade", x === NONE ? "" : (x as SupplierGrade))}>
            <SelectTrigger id="grade" className="w-full"><SelectValue placeholder="—" /></SelectTrigger>
            <SelectContent><SelectItem value={NONE}>—</SelectItem>{SUPPLIER_GRADES.map((x) => <SelectItem key={x} value={x}>{GRADE_HINT[x]}</SelectItem>)}</SelectContent>
          </Select>
        </FieldRow>
        <FieldRow label="USCC (optional)" htmlFor="uscc" error={errors.uscc} hint="18 characters, 统一社会信用代码">
          <Input id="uscc" value={v.uscc} onChange={(e) => set("uscc", e.target.value.toUpperCase())} className="font-mono" maxLength={18} aria-invalid={!!errors.uscc} />
        </FieldRow>
        <FieldRow label="Registered (optional)" htmlFor="registeredAt" error={errors.registeredAt}>
          <Input id="registeredAt" type="date" value={v.registeredAt} onChange={(e) => set("registeredAt", e.target.value)} className="font-mono" />
        </FieldRow>
        <FieldRow label="Capital (optional)" htmlFor="capital">
          <Input id="capital" value={v.capital} onChange={(e) => set("capital", e.target.value)} placeholder="5 M CNY" className="font-mono" />
        </FieldRow>
        <FieldRow label="City" htmlFor="city">
          <Input id="city" value={v.city} onChange={(e) => set("city", e.target.value)} placeholder="Dongguan" />
        </FieldRow>
        <FieldRow label="Province (optional)" htmlFor="province">
          <Input id="province" value={v.province} onChange={(e) => set("province", e.target.value)} placeholder="Guangdong" />
        </FieldRow>
        <FieldRow label="Country" htmlFor="country">
          <Input id="country" value={v.country} onChange={(e) => set("country", e.target.value.toUpperCase())} maxLength={2} className="font-mono" />
        </FieldRow>
        <FieldRow label="Website (optional)" htmlFor="website">
          <Input id="website" value={v.website} onChange={(e) => set("website", e.target.value)} placeholder="https://" />
        </FieldRow>
      </div>
      <FieldRow label="Ports" hint="Ports the factory ships from">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Ports">
          {PORTS.map((p) => {
            const on = v.ports.includes(p);
            return (
              <button key={p} type="button" aria-pressed={on} onClick={() => set("ports", on ? v.ports.filter((x) => x !== p) : [...v.ports, p])}
                className={`h-7 rounded-md border px-2.5 text-xs font-medium transition-colors ${on ? "border-green-200 bg-green-50 text-green-700" : "border-input bg-card text-ink-2 hover:bg-surface-sunken"}`}>
                {p}
              </button>
            );
          })}
        </div>
      </FieldRow>
      <FieldRow label="Notes (optional)" htmlFor="notes" hint="Payment terms, quirks, what to verify next — internal only">
        <Textarea id="notes" rows={3} value={v.notes} onChange={(e) => set("notes", e.target.value)} />
      </FieldRow>
      {mode === "create" && (
        <fieldset className="border-t border-rule-ink pt-4">
          <legend className="eyebrow mb-3">First contact (optional)</legend>
          <div className="grid grid-cols-2 gap-4">
            <FieldRow label="Contact name" htmlFor="c-name" error={errors.name}>
              <Input id="c-name" value={contact.name} onChange={(e) => setContact((c) => ({ ...c, name: e.target.value }))} placeholder="Daryl Yang" />
            </FieldRow>
            <FieldRow label="Channel" htmlFor="c-channel">
              <Select value={contact.channel} onValueChange={(x) => setContact((c) => ({ ...c, channel: x as ContactChannel }))}>
                <SelectTrigger id="c-channel" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{CONTACT_CHANNELS.map((x) => <SelectItem key={x} value={x}>{CHANNEL_LABEL[x]}</SelectItem>)}</SelectContent>
              </Select>
            </FieldRow>
            <FieldRow label="Handle / address" htmlFor="c-handle">
              <Input id="c-handle" value={contact.handle} onChange={(e) => setContact((c) => ({ ...c, handle: e.target.value }))} placeholder="wechat id, email, store id" className="font-mono" />
            </FieldRow>
            <FieldRow label="Phone" htmlFor="c-phone">
              <Input id="c-phone" value={contact.phone} onChange={(e) => setContact((c) => ({ ...c, phone: e.target.value }))} placeholder="+86 …" className="font-mono" />
            </FieldRow>
          </div>
        </fieldset>
      )}
      {errors._ && <p className="text-xs text-danger" role="alert">{errors._}</p>}
    </FormShell>
  );
}
