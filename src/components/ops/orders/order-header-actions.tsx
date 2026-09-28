"use client";
import * as React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { MoreHorizontal, Eye, MessageCircle, Upload, PauseCircle, PlayCircle, XCircle } from "lucide-react";
import type { OpsOrderDetail } from "@/server/ops/orders";
import { LINE_STATES, type LineState } from "@/db/enums";
import { FormShell } from "@/components/shared/form-shell";
import { StateChip } from "@/components/shared/chips";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { changeOrderStateAction, setOrderExceptionAction, logWhatsAppAction, closeOrderAction } from "@/app/(ops)/ops/orders/actions";
import { useAct, Field, TextField, TextareaField, fd, str, opt } from "./ui";

/** Header actions (DESIGN §6.10): Change state (sheet with allowed transitions as radio rows + note), stage primary, ⋯ menu. */
export function OrderHeaderActions({ d }: { d: OpsOrderDetail }) {
  const o = d.order;
  const { act, pending } = useAct();
  const primary = o.primaryAction;
  return (
    <>
      <ChangeStateSheet d={d} />
      {primary && primary.key === "close" ? (
        <Button data-testid="primary-action" disabled={pending} onClick={() => act(() => closeOrderAction({ orderId: o.id }), { success: "Order closed" })}>{primary.label}</Button>
      ) : primary ? (
        <Button asChild data-testid="primary-action"><a href={primary.anchor}>{primary.label}</a></Button>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button variant="outline" size="icon" aria-label="More actions"><MoreHorizontal /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <LogWhatsAppItem orderId={o.id} orderRef={o.ref} />
          <DropdownMenuItem asChild><a href="#documents"><Upload />Upload document</a></DropdownMenuItem>
          <DropdownMenuItem asChild><Link href={`/ops/orders/${o.ref}/preview`}><Eye />Preview as client</Link></DropdownMenuItem>
          <DropdownMenuSeparator />
          {o.exception === "on_hold" ? (
            <DropdownMenuItem onSelect={() => act(() => setOrderExceptionAction({ orderId: o.id, exception: null }), { success: "Resumed" })}><PlayCircle />Resume</DropdownMenuItem>
          ) : (
            <HoldItem orderId={o.id} />
          )}
          {o.exception !== "cancelled" && <CancelItem orderId={o.id} />}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

function ChangeStateSheet({ d }: { d: OpsOrderDetail }) {
  const o = d.order;
  const ts = useTranslations("state");
  const { act } = useAct();
  // QA-16b: preselect the first legal move so Apply never silently does nothing
  const [to, setTo] = React.useState<LineState | "">(o.allowedTransitions[0] ?? "");
  const [override, setOverride] = React.useState(false);
  const options = override ? LINE_STATES.filter((s) => s !== o.state) : o.allowedTransitions;
  return (
    <FormShell
      trigger={<Button variant="outline" data-testid="change-state">Change state</Button>}
      eyebrow={o.ref}
      title="Change state"
      description="Only the transitions allowed from the current state are listed. Side effects (payments, ETAs, emails) live in the sections below — use those for the normal path."
      submitLabel="Apply"
      onSubmit={async (e) => {
        const f = fd(e);
        if (!to) { toast.error("Pick the state to move to."); return false; }
        return act(() => changeOrderStateAction({ orderId: o.id, to, note: opt(f, "note") ?? undefined, overrideReason: override ? str(f, "reason") : undefined }), { success: `State → ${ts(to)}` });
      }}
    >
      <div className="flex items-center gap-2 text-sm"><span className="text-muted-foreground">From</span><StateChip state={o.state} /></div>
      <Field label="To">
        <div role="radiogroup" className="sheet">
          {options.length === 0 && <p className="sheet-row text-sm text-muted-foreground">No further transition from this state.</p>}
          {options.map((s) => (
            <label key={s} className={cn("sheet-row flex cursor-pointer items-center gap-3 text-sm hover:bg-surface-sunken", to === s && "bg-green-50")}>
              <input type="radio" name="to" value={s} checked={to === s} onChange={() => setTo(s)} className="accent-green-600" />
              <StateChip state={s} />
            </label>
          ))}
        </div>
      </Field>
      <TextareaField name="note" label="Note (client-visible, optional)" rows={2} />
      {o.isAdmin && (
        <div className="rounded-lg border border-warning-border bg-warning-wash p-3">
          <label className="flex items-center gap-2 text-sm font-medium text-warning"><input type="checkbox" checked={override} onChange={(e) => { setOverride(e.target.checked); setTo(""); }} className="accent-green-600" />Override state (admin)</label>
          {override && <div className="mt-2"><Textarea name="reason" placeholder="Mandatory reason" required rows={2} /></div>}
        </div>
      )}
    </FormShell>
  );
}

function LogWhatsAppItem({ orderId, orderRef }: { orderId: string; orderRef: string }) {
  const { act } = useAct();
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <DropdownMenuItem onSelect={(e) => { e.preventDefault(); setOpen(true); }}><MessageCircle />Log WhatsApp</DropdownMenuItem>
      <FormShell open={open} onOpenChange={setOpen} eyebrow={orderRef} title="Log WhatsApp" submitLabel="Log" onSubmit={async (e) => { const f = fd(e); return act(() => logWhatsAppAction({ orderId, counterparty: str(f, "counterparty"), body: str(f, "body") }), { success: "WhatsApp logged" }); }}>
        <TextField name="counterparty" label="Counterparty" placeholder="Daryl (factory)" required autoFocus />
        <TextareaField name="body" label="Pasted text" rows={6} required />
        <p className="text-xs text-muted-foreground">Internal only — never shown to the client.</p>
      </FormShell>
    </>
  );
}

function HoldItem({ orderId }: { orderId: string }) {
  const { act } = useAct();
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <DropdownMenuItem onSelect={(e) => { e.preventDefault(); setOpen(true); }}><PauseCircle />Put on hold</DropdownMenuItem>
      <FormShell open={open} onOpenChange={setOpen} title="Put on hold" submitLabel="Hold" onSubmit={async (e) => { const f = fd(e); return act(() => setOrderExceptionAction({ orderId, exception: "on_hold", reason: str(f, "reason") }), { success: "On hold" }); }}>
        <TextareaField name="reason" label="Reason (client-visible, leak-checked)" required rows={3} />
      </FormShell>
    </>
  );
}

function CancelItem({ orderId }: { orderId: string }) {
  const { act } = useAct();
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <DropdownMenuItem className="text-danger" onSelect={(e) => { e.preventDefault(); setOpen(true); }}><XCircle />Cancel order</DropdownMenuItem>
      <FormShell open={open} onOpenChange={setOpen} title="Cancel order" submitLabel="Cancel order" submitVariant="destructive" onSubmit={async (e) => { const f = fd(e); return act(() => setOrderExceptionAction({ orderId, exception: "cancelled", reason: str(f, "reason") }), { success: "Order cancelled" }); }}>
        <TextareaField name="reason" label="Reason" required rows={3} />
        <p className="text-xs text-muted-foreground">The state and milestone are kept for history; the order leaves every dashboard count.</p>
      </FormShell>
    </>
  );
}
