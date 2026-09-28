"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SectionHeading } from "@/components/shared/section-band";
import { cn } from "@/lib/utils";
import type { ActionResult } from "@/server/shared/http";
import { ERRORS } from "./strings";

/** Runs a server action, toasts the result, refreshes the page data. Returns true on success (closes sheets). */
export function useAct() {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const act = React.useCallback(
    <T,>(fn: () => Promise<ActionResult<T>>, opts?: { success?: string; onSuccess?: (data: T) => void; onError?: (r: Extract<ActionResult<T>, { ok: false }>) => void }) =>
      new Promise<boolean>((resolve) => {
        start(async () => {
          const r = await fn();
          if (r.ok) { if (opts?.success) toast.success(opts.success); opts?.onSuccess?.(r.data); router.refresh(); resolve(true); }
          else {
            const detail = r.errors ? Object.entries(r.errors).map(([k, v]) => `${k}: ${v}`).join(" · ") : r.hits ? r.hits.map((h) => `${h.kind}: ${h.match}`).join(" · ") : "";
            toast.error(ERRORS[r.error] ?? r.error, detail ? { description: detail } : undefined);
            opts?.onError?.(r);
            resolve(false);
          }
        });
      }),
    [router],
  );
  return { act, pending };
}

/** DESIGN §5.10 — label 12px/500 above the control, helper below. */
export function Field({ label, htmlFor, hint, children, className }: { label: React.ReactNode; htmlFor?: string; hint?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={htmlFor} className="text-xs font-medium text-ink-2">{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function TextField(p: { name: string; label: string; defaultValue?: string | null; type?: string; required?: boolean; placeholder?: string; hint?: string; mono?: boolean; autoFocus?: boolean; min?: string; step?: string }) {
  return (
    <Field label={p.label} htmlFor={p.name} hint={p.hint}>
      <Input id={p.name} name={p.name} type={p.type ?? "text"} defaultValue={p.defaultValue ?? undefined} required={p.required} placeholder={p.placeholder} className={cn(p.mono && "font-mono")} autoFocus={p.autoFocus} min={p.min} step={p.step} />
    </Field>
  );
}

/** EU date field (dd.mm.yyyy shown, ISO posted under `name`). */
export function DateField(p: { name: string; label: string; defaultValue?: string | null; required?: boolean; hint?: string; min?: string; max?: string }) {
  return (
    <Field label={p.label} htmlFor={p.name} hint={p.hint}>
      <DateInput id={p.name} name={p.name} defaultValue={p.defaultValue ?? undefined} required={p.required} min={p.min} max={p.max} />
    </Field>
  );
}

export function TextareaField(p: { name: string; label: string; defaultValue?: string | null; required?: boolean; placeholder?: string; rows?: number; hint?: string }) {
  return (
    <Field label={p.label} htmlFor={p.name} hint={p.hint}>
      <Textarea id={p.name} name={p.name} defaultValue={p.defaultValue ?? undefined} required={p.required} placeholder={p.placeholder} rows={p.rows ?? 3} />
    </Field>
  );
}

export function SelectField<T extends string>(p: { name: string; label: string; options: { value: T; label: string }[]; defaultValue?: T; value?: T; onChange?: (v: T) => void; hint?: string; placeholder?: string }) {
  return (
    <Field label={p.label} htmlFor={p.name} hint={p.hint}>
      <Select name={p.name} defaultValue={p.defaultValue} value={p.value} onValueChange={(v) => p.onChange?.(v as T)}>
        <SelectTrigger id={p.name} className="w-full"><SelectValue placeholder={p.placeholder ?? "Select…"} /></SelectTrigger>
        <SelectContent>{p.options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
      </Select>
    </Field>
  );
}

export function FileField(p: { name?: string; label: string; accept?: string; required?: boolean; hint?: string }) {
  return (
    <Field label={p.label} htmlFor={p.name ?? "file"} hint={p.hint}>
      <Input id={p.name ?? "file"} name={p.name ?? "file"} type="file" accept={p.accept} required={p.required} className="pt-1.5" />
    </Field>
  );
}

export function Checkbox(p: { name: string; label: string; defaultChecked?: boolean; checked?: boolean; onChange?: (v: boolean) => void; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-2 text-sm">
      <input type="checkbox" name={p.name} defaultChecked={p.defaultChecked} checked={p.checked} onChange={(e) => p.onChange?.(e.target.checked)} className="mt-0.5 size-4 rounded border-input accent-green-600" />
      <span><span className="font-medium text-foreground">{p.label}</span>{p.hint && <span className="block text-xs text-muted-foreground">{p.hint}</span>}</span>
    </label>
  );
}

export const fd = (e: React.FormEvent<HTMLFormElement>) => new FormData(e.currentTarget);
export const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
export const opt = (f: FormData, k: string) => { const v = str(f, k); return v ? v : null; };
export const num = (f: FormData, k: string) => { const v = str(f, k); return v ? Number(v) : null; };
/** money input "1,234.56" → minor */
export const minor = (f: FormData, k: string) => { const v = str(f, k).replace(/[,\s]/g, ""); return v ? Math.round(Number(v) * 100) : 0; };

/**
 * One numbered section of the order page (DESIGN §6.10) rendered as a band: the page stacks them and alternates the
 * ground (page / white), so each section reads as its own division. Heading = number pill + H2 + open chip + actions.
 * Section actions are `outline`/`ghost` size sm — the header owns the one primary.
 */
export function OrderSection({ id, number, title, count, action, children, className }: { id: string; number: number; title: string; count?: number; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section id={id} className={cn("scroll-under-header", className)} aria-labelledby={`${id}-h`} data-testid={`section-${id}`}>
      <SectionHeading number={number} title={<span id={`${id}-h`} className="inline-flex items-center gap-2">{title}{typeof count === "number" && count > 0 && <span className="inline-flex h-5 items-center rounded-md border border-warning-border bg-warning-wash px-1.5 font-mono text-2xs font-medium text-warning">{count} open</span>}</span>} action={action} className="border-t-0 pt-0" />
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** Definition row (label 12 muted, value mono 13). */
export function DetailRow({ label, children, mono = true }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-hairline-faint py-2.5 last:border-b-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("text-right text-[13px] text-foreground", mono && "font-mono tabular-nums")}>{children}</dd>
    </div>
  );
}
