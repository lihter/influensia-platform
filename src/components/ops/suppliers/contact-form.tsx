"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { ActionResult } from "@/server/shared/http";
import type { ContactFormInput } from "@/app/(ops)/ops/suppliers/actions";
import { CONTACT_CHANNELS, type ContactChannel } from "@/db/enums";
import { FormShell } from "@/components/shared/form-shell";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CHANNEL_LABEL } from "./labels";
import { FieldRow } from "./supplier-form";

export type ContactValues = { name: string; channel: ContactChannel; handle: string; phone: string; isPrimary: boolean };

/** Add / edit contact sheet. Name or handle required; channel enum (SPEC F-21). */
export function ContactForm({ supplierId, supplierRef, contactId, initial, trigger, open, onOpenChange, onAdd, onUpdate }: {
  supplierId: string; supplierRef: string; contactId?: string; initial?: Partial<ContactValues>; trigger?: React.ReactNode; open?: boolean; onOpenChange?: (o: boolean) => void;
  onAdd: (i: { supplierId: string; supplierRef: string } & ContactFormInput) => Promise<ActionResult<{ id: string }>>;
  onUpdate: (i: { contactId: string; supplierRef: string } & ContactFormInput) => Promise<ActionResult<undefined>>;
}) {
  const router = useRouter();
  const base: ContactValues = { name: "", channel: "alibaba", handle: "", phone: "", isPrimary: false, ...initial };
  const [v, setV] = React.useState<ContactValues>(base);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [prevOpen, setPrevOpen] = React.useState(open);
  if (open !== prevOpen) { setPrevOpen(open); if (open) { setV({ name: "", channel: "alibaba", handle: "", phone: "", isPrimary: false, ...initial }); setErrors({}); } }
  const set = <K extends keyof ContactValues>(k: K, val: ContactValues[K]) => setV((s) => ({ ...s, [k]: val }));

  return (
    <FormShell trigger={trigger} open={open} onOpenChange={onOpenChange} eyebrow={supplierRef} title={contactId ? "Edit contact" : "Add contact"} submitLabel={contactId ? "Save" : "Add contact"}
      onSubmit={async () => {
        setErrors({});
        const input = { name: v.name || null, channel: v.channel, handle: v.handle || null, phone: v.phone || null, isPrimary: v.isPrimary };
        const r = contactId ? await onUpdate({ contactId, supplierRef, ...input }) : await onAdd({ supplierId, supplierRef, ...input });
        if (!r.ok) { setErrors(r.errors ?? { _: r.error }); toast.error(r.errors ? "Check the highlighted fields" : r.error); return false; }
        toast.success(contactId ? "Contact saved" : "Contact added");
        router.refresh();
        return true;
      }}>
      <FieldRow label="Name" htmlFor="ct-name" error={errors.name} hint="Name or handle is required">
        <Input id="ct-name" value={v.name} onChange={(e) => set("name", e.target.value)} placeholder="Daryl Yang" autoFocus aria-invalid={!!errors.name} />
      </FieldRow>
      <FieldRow label="Channel" htmlFor="ct-channel">
        <Select value={v.channel} onValueChange={(x) => set("channel", x as ContactChannel)}>
          <SelectTrigger id="ct-channel" className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>{CONTACT_CHANNELS.map((x) => <SelectItem key={x} value={x}>{CHANNEL_LABEL[x]}</SelectItem>)}</SelectContent>
        </Select>
      </FieldRow>
      <FieldRow label="Handle / address" htmlFor="ct-handle" error={errors.handle}>
        <Input id="ct-handle" value={v.handle} onChange={(e) => set("handle", e.target.value)} placeholder="wechat id, email, store id" className="font-mono" />
      </FieldRow>
      <FieldRow label="Phone (optional)" htmlFor="ct-phone">
        <Input id="ct-phone" value={v.phone} onChange={(e) => set("phone", e.target.value)} placeholder="+86 …" className="font-mono" />
      </FieldRow>
      <label className="flex items-center gap-2 text-sm text-ink-2">
        <input type="checkbox" checked={v.isPrimary} onChange={(e) => set("isPrimary", e.target.checked)} className="size-4 rounded-sm accent-green-600" />
        Primary contact
      </label>
      {errors._ && <p className="text-xs text-danger" role="alert">{errors._}</p>}
    </FormShell>
  );
}
