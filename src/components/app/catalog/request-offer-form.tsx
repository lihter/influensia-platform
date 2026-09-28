"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertCircle } from "lucide-react";
import type { ClientCatalogDto } from "@/server/client/dto";
import type { ClientCatalogRequestDto } from "@/server/client/dto/catalog";
import type { ActionResult } from "@/server/shared/http";
import { formatQty } from "@/server/shared/money";
import { FormShell } from "@/components/shared/form-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ReferencePrice } from "./catalog-card";

/**
 * F-11 "Request offer": qty (defaults to the reference MOQ) + note → server action → toast → /app/requests.
 * Client component; the only data it holds is the client DTO.
 */
export function RequestOfferForm({ p, action, size = "default", className }: { p: ClientCatalogDto; action: (i: { productRef: string; qty: number; note?: string | null }) => Promise<ActionResult<ClientCatalogRequestDto>>; size?: "default" | "lg"; className?: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [qty, setQty] = React.useState(String(p.referenceMoq ?? 1));
  const [note, setNote] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const belowMoq = p.referenceMoq != null && Number(qty) > 0 && Number(qty) < p.referenceMoq;
  return (
    <FormShell
      open={open} onOpenChange={(o) => { setOpen(o); if (o) { setQty(String(p.referenceMoq ?? 1)); setNote(""); setError(null); } }}
      trigger={<Button variant="outline" size={size} className={className} data-testid="request-offer">Request offer</Button>}
      eyebrow={p.ref} title="Request an offer" description="We confirm the price for your quantity and send an offer — usually within 5 working days." submitLabel="Send request" submitVariant="action"
      onSubmit={async () => {
        setError(null);
        const n = Number(qty);
        if (!Number.isInteger(n) || n <= 0) { setError("Enter a whole number above 0"); return false; }
        const r = await action({ productRef: p.ref, qty: n, note: note || null });
        if (!r.ok) { setError(r.errors?.qty ?? r.errors?._ ?? "Something went wrong — please try again"); return false; }
        toast.success(`Request ${r.data.requestRef} sent — ${r.data.name}`, { description: `${formatQty(r.data.qty, r.data.unit)} · we'll confirm the price and send an offer.` });
        router.push("/app/requests");
        router.refresh();
        return true;
      }}
    >
      <div className="rounded-xl border border-border bg-card p-4">
        <p className="text-[15px] font-medium">{p.name}</p>
        <div className="mt-2"><ReferencePrice p={p} /></div>
      </div>
      <div>
        <Label htmlFor="qty" className="mb-1.5 block text-xs font-medium text-ink-2">Quantity</Label>
        <div className="relative">
          <Input id="qty" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value.replace(/[^\d]/g, ""))} className="h-10 pr-14 text-right font-mono" aria-invalid={!!error} autoFocus />
          <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 font-mono text-xs text-muted-foreground">{p.unit}</span>
        </div>
        {belowMoq && <p className="mt-1 text-xs text-warning">Below the reference MOQ of {formatQty(p.referenceMoq!, p.unit)} — we&apos;ll check what the price looks like at this quantity.</p>}
        {error && <p className="mt-1 flex items-center gap-1 text-xs text-danger" role="alert"><AlertCircle className="size-3" />{error}</p>}
      </div>
      <div>
        <Label htmlFor="note" className="mb-1.5 block text-xs font-medium text-ink-2">Anything we should know? (optional)</Label>
        <Textarea id="note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Colour, packaging, delivery date…" />
      </div>
    </FormShell>
  );
}
