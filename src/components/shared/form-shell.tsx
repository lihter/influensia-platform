"use client";
import * as React from "react";
import { Loader2 } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Eyebrow } from "./eyebrow";
import { cn } from "@/lib/utils";

/**
 * DESIGN §5.9 — side sheet for create/edit. Header: eyebrow (context ref) + H2; body scrolls; sticky footer with
 * Cancel (ghost, left) and the primary (right). Width 480px (`wide` → 640px).
 * Usage: <FormShell trigger={<Button>Log quote</Button>} eyebrow="REQ-2026-0312-01" title="Log quote" onSubmit={...}>fields</FormShell>
 */
export function FormShell({ trigger, eyebrow, title, description, children, submitLabel = "Save", cancelLabel = "Cancel", onSubmit, pending, wide, open, onOpenChange, submitVariant = "default", footerExtra, className }: {
  trigger?: React.ReactNode;
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  submitLabel?: string;
  cancelLabel?: string;
  /** form submit handler; return false / throw to keep the sheet open */
  onSubmit?: (e: React.FormEvent<HTMLFormElement>) => void | Promise<void | boolean>;
  pending?: boolean;
  wide?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  submitVariant?: "default" | "green" | "action" | "destructive";
  footerExtra?: React.ReactNode;
  className?: string;
}) {
  const [internalOpen, setInternalOpen] = React.useState(false);
  const isOpen = open ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;
  const [busy, setBusy] = React.useState(false);
  const isPending = pending ?? busy;

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!onSubmit) return;
    setBusy(true);
    try {
      const r = await onSubmit(e);
      if (r !== false) setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={isOpen} onOpenChange={setOpen}>
      {trigger && <SheetTrigger asChild>{trigger}</SheetTrigger>}
      <SheetContent side="right" className={cn("gap-0 p-0", wide && "sm:max-w-[40rem]", className)}>
        <form onSubmit={submit} className="flex h-full flex-col">
          <SheetHeader className="border-b border-border px-6 py-5 text-left">
            {eyebrow && <Eyebrow className="mb-1">{eyebrow}</Eyebrow>}
            <SheetTitle className="text-lg font-semibold">{title}</SheetTitle>
            {description ? <SheetDescription className="text-sm text-ink-2">{description}</SheetDescription> : <SheetDescription className="sr-only">{title}</SheetDescription>}
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-6 py-5">
            <div className="flex flex-col gap-5">{children}</div>
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-border bg-card p-4">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={isPending}>{cancelLabel}</Button>
            <div className="flex items-center gap-2">
              {footerExtra}
              <Button type="submit" variant={submitVariant} disabled={isPending}>
                {isPending && <Loader2 className="animate-spin" />}
                {submitLabel}
              </Button>
            </div>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
