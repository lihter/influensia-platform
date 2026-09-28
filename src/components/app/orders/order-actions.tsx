"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, MessageCircleQuestion, Upload, PackageCheck, RotateCcw } from "lucide-react";
import type { ClientOrderPageDto } from "@/server/client/dto/orders";
import type { ActionResult } from "@/server/shared/http";
import { FormShell } from "@/components/shared/form-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Qty } from "@/components/shared/formatters";
import { confirmDeliveryAction, uploadArtworkAction, askAboutOrderAction, reorderAction } from "@/app/(client)/app/orders/[ref]/actions";

const ERR: Record<string, string> = {
  E_LEAK_CHECK: "That file name can't be used — please rename it and try again.",
  E_VALIDATION: "Please check the form.",
  E_NOT_DELIVERED: "This order hasn't been delivered yet.",
  E_NOT_REORDERABLE: "Only delivered orders can be reordered.",
  E_NO_LINES: "Choose at least one line.",
  E_ILLEGAL_TRANSITION: "This step isn't available right now.",
};

function useClientAct() {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const act = React.useCallback(<T,>(fn: () => Promise<ActionResult<T>>, opts?: { success?: string; onSuccess?: (d: T) => void }) => new Promise<boolean>((resolve) => start(async () => {
    const r = await fn();
    if (r.ok) { if (opts?.success) toast.success(opts.success); opts?.onSuccess?.(r.data); router.refresh(); resolve(true); }
    else { const field = r.errors ? Object.values(r.errors)[0] : undefined; toast.error(r.message ?? field ?? ERR[r.error] ?? "Something went wrong — please try again."); resolve(false); }
  })), [router]);
  return { act, pending };
}

/** "Ask about this order" — outline button in the header; question → agent. */
export function AskSheet({ orderRef, disabled }: { orderRef: string; disabled?: boolean }) {
  const { act } = useClientAct();
  return (
    <FormShell trigger={<Button variant="outline" size="lg" disabled={disabled} data-testid="ask"><MessageCircleQuestion data-icon="inline-start" />Ask about this order</Button>} eyebrow={orderRef} title="Ask about this order" description="Your contact at Influensia answers here and by email." submitLabel="Send question" submitVariant="action"
      onSubmit={async (e) => { const f = new FormData(e.currentTarget); return act(() => askAboutOrderAction({ ref: orderRef, text: String(f.get("text") ?? "") }), { success: "Question sent" }); }}>
      <div className="flex flex-col gap-1.5"><Label htmlFor="ask-text" className="text-xs font-medium text-ink-2">Your question</Label><Textarea id="ask-text" name="text" rows={5} required minLength={3} autoFocus /></div>
    </FormShell>
  );
}

/** "Upload artwork" per line (pdf/ai/png/jpg ≤ 25 MB, optional note). */
export function UploadArtworkSheet({ orderRef, line, variant = "action", label = "Upload artwork", disabled }: { orderRef: string; line: { orderLineId: string; lineRef: string; name: string }; variant?: "action" | "outline"; label?: string; disabled?: boolean }) {
  const { act } = useClientAct();
  return (
    <FormShell trigger={<Button variant={variant} size="lg" disabled={disabled} data-testid="upload-artwork"><Upload data-icon="inline-start" />{label}</Button>} eyebrow={`${orderRef} · ${line.lineRef}`} title={`Artwork — ${line.name}`} description="PDF, AI, PNG or JPG up to 25 MB. We check it against the dieline and confirm within a working day." submitLabel="Upload" submitVariant="action"
      onSubmit={async (e) => { const f = new FormData(e.currentTarget); f.set("ref", orderRef); f.set("orderLineId", line.orderLineId); return act(() => uploadArtworkAction(f), { success: "Artwork uploaded — under review" }); }}>
      <div className="flex flex-col gap-1.5"><Label htmlFor="art-file" className="text-xs font-medium text-ink-2">File</Label><Input id="art-file" name="file" type="file" accept=".pdf,.ai,.png,.jpg,.jpeg" required className="h-10 pt-2" /></div>
      <div className="flex flex-col gap-1.5"><Label htmlFor="art-note" className="text-xs font-medium text-ink-2">Note (optional)</Label><Textarea id="art-note" name="note" rows={3} maxLength={500} placeholder="Anything we should know about this version" /></div>
    </FormShell>
  );
}

/** "Confirm delivery" — the ▲ action at step 9. */
export function ConfirmDeliveryButton({ orderRef, disabled, size = "lg" }: { orderRef: string; disabled?: boolean; size?: "lg" | "default" }) {
  const { act, pending } = useClientAct();
  const [open, setOpen] = React.useState(false);
  const [issues, setIssues] = React.useState("");
  return (
    <>
      <Button variant="action" size={size} disabled={disabled} onClick={() => setOpen(true)} data-testid="confirm-delivery"><PackageCheck data-icon="inline-start" />Confirm delivery</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Confirm you received {orderRef}</DialogTitle><DialogDescription>This closes the order. You can reorder it any time.</DialogDescription></DialogHeader>
          <div className="flex flex-col gap-1.5"><Label htmlFor="issues" className="text-xs font-medium text-ink-2">Any issues? (optional)</Label><Textarea id="issues" value={issues} onChange={(e) => setIssues(e.target.value)} rows={3} maxLength={1000} /></div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="action" disabled={pending} data-testid="confirm-delivery-submit" onClick={() => act(() => confirmDeliveryAction({ ref: orderRef, issues: issues || undefined }), { success: "Delivery confirmed — thank you", onSuccess: () => setOpen(false) })}>{pending && <Loader2 className="animate-spin" />}Confirm delivery</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** "Reorder" — per line qty (default previous), creates a repeat request and navigates to it (F-12). */
export function ReorderSheet({ dto, disabled }: { dto: ClientOrderPageDto; disabled?: boolean }) {
  const { act } = useClientAct();
  const router = useRouter();
  const [qty, setQty] = React.useState<Record<string, string>>(Object.fromEntries(dto.order.lines.map((l) => [l.id, String(l.qty)])));
  const [on, setOn] = React.useState<Record<string, boolean>>(Object.fromEntries(dto.order.lines.map((l) => [l.id, true])));
  return (
    <FormShell trigger={<Button variant="outline" size="lg" disabled={disabled} data-testid="reorder"><RotateCcw data-icon="inline-start" />Reorder</Button>} eyebrow={dto.order.ref} title="Reorder" description="Same product and specification. If the price still holds we skip straight to a confirmation; otherwise we re-check with the factory." submitLabel="Create request" submitVariant="action"
      onSubmit={async () => act(() => reorderAction({ ref: dto.order.ref, lines: dto.order.lines.filter((l) => on[l.id]).map((l) => ({ orderLineId: l.id, qty: Number(qty[l.id]) || 0 })) }), { success: "Request created", onSuccess: (r) => router.push(r.href) })}>
      <ul className="sheet">
        {dto.order.lines.map((l) => (
          <li key={l.id} className="sheet-row grid grid-cols-[auto_1fr_7rem] items-center gap-3">
            <input type="checkbox" className="size-4 accent-green-600" checked={!!on[l.id]} onChange={(e) => setOn((s) => ({ ...s, [l.id]: e.target.checked }))} aria-label={`Include ${l.name}`} />
            <div className="min-w-0"><div className="truncate text-sm font-medium">{l.name}</div><div className="text-xs text-muted-foreground">last time <Qty qty={l.qty} unit={l.unit} /></div></div>
            <div className="relative"><Input type="number" min={1} value={qty[l.id]} onChange={(e) => setQty((s) => ({ ...s, [l.id]: e.target.value }))} className="h-10 pr-10 text-right font-mono" aria-label={`Quantity for ${l.name}`} /><span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-muted-foreground">{l.unit}</span></div>
          </li>
        ))}
      </ul>
    </FormShell>
  );
}
