"use client";
import * as React from "react";
import { AlertCircle, ChevronDown } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** DESIGN §5.10: 12px/500 label, 6px gap, helper 12px muted, error 12px danger with AlertCircle. */
export function Field({ id, label, hint, error, optional, children, className }: { id: string; label: string; hint?: string; error?: string; optional?: boolean; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)} data-field={id}>
      <Label htmlFor={id} className="text-xs font-medium text-ink-2">
        {label}{optional && <span className="font-normal text-muted-foreground"> (optional)</span>}
      </Label>
      {children}
      {error ? (
        <p className="flex items-center gap-1 text-xs text-danger" role="alert"><AlertCircle className="size-3" />{error}</p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

export function TextField({ id, label, hint, error, optional, className, ...props }: { label: string; hint?: string; error?: string; optional?: boolean } & React.ComponentProps<"input"> & { id: string }) {
  return (
    <Field id={id} label={label} hint={hint} error={error} optional={optional} className={className}>
      <Input id={id} name={id} aria-invalid={error ? true : undefined} {...props} />
    </Field>
  );
}

/** Native select styled like `Input` (36px, rounded-lg, white). Native so forms post cleanly and tests can `selectOption`. */
export function NativeSelect({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <div className="relative">
      <select
        data-slot="select"
        className={cn(
          "h-9 w-full appearance-none rounded-lg border border-input bg-card py-1 pr-8 pl-3 text-sm text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:opacity-60 aria-invalid:border-destructive",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
}

export function SelectField({ id, label, hint, error, optional, options, className, ...props }: { id: string; label: string; hint?: string; error?: string; optional?: boolean; options: readonly { value: string; label: string }[] } & React.ComponentProps<"select">) {
  return (
    <Field id={id} label={label} hint={hint} error={error} optional={optional} className={className}>
      <NativeSelect id={id} name={id} aria-invalid={error ? true : undefined} {...props}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </NativeSelect>
    </Field>
  );
}

/** Read-only definition row (Settings card for agents, company details for clients). */
export function DefRow({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-4 py-2.5 text-sm">
      <dt className="shrink-0 text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className={cn("min-w-0 truncate text-right text-foreground", mono && "font-mono text-[13px] tabular-nums")}>{children ?? <span className="text-faint">—</span>}</dd>
    </div>
  );
}

/** Pulls `{ field: message }` from an ActionResult error into a state setter-friendly map. */
export function fieldErrors(errors?: Record<string, string>): Record<string, string> {
  return errors ?? {};
}
