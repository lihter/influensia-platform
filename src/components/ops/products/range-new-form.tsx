"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Search } from "lucide-react";
import type { ActionResult } from "@/server/shared/http";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { VerdictChip } from "@/components/ops/suppliers/labels";
import { cn } from "@/lib/utils";
import type { SupplierTypeVerdict } from "@/db/enums";

type SupplierOpt = { id: string; ref: string; legalName: string; cnName: string | null; city: string | null; typeVerdict: SupplierTypeVerdict };

/** F-25 "New range": pick supplier (search) + client org → creates the draft and opens it. */
export function RangeNewForm({ suppliers, orgs, presetSupplierId, presetOrgId, action }: { suppliers: SupplierOpt[]; orgs: { id: string; name: string }[]; presetSupplierId?: string; presetOrgId?: string; action: (i: { supplierId: string; orgId: string }) => Promise<ActionResult<{ id: string; ref: string }>> }) {
  const router = useRouter();
  const [q, setQ] = React.useState("");
  const [supplierId, setSupplierId] = React.useState(presetSupplierId ?? "");
  const [orgId, setOrgId] = React.useState(presetOrgId ?? "");
  const [pending, setPending] = React.useState(false);
  const n = q.trim().toLowerCase();
  const list = suppliers.filter((s) => !n || `${s.ref} ${s.legalName} ${s.cnName ?? ""} ${s.city ?? ""}`.toLowerCase().includes(n)).slice(0, 12);
  const chosen = suppliers.find((s) => s.id === supplierId);
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="rounded-xl border border-border bg-card p-5">
        <p className="eyebrow mb-1">01 · Supplier</p>
        <p className="mb-3 text-xs text-muted-foreground">The factory whose range you are publishing. The client never sees this name.</p>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search ref, name, 中文, city" className="pl-8" aria-label="Search suppliers" data-testid="range-supplier-search" />
        </div>
        <ul className="mt-3 max-h-80 overflow-auto rounded-xl border border-border" role="listbox" aria-label="Suppliers">
          {list.map((s) => (
            <li key={s.id} role="option" aria-selected={s.id === supplierId}>
              <button type="button" onClick={() => setSupplierId(s.id)} className={cn("flex w-full items-center gap-3 border-b border-hairline-faint px-3 py-2 text-left text-sm transition-colors last:border-b-0 hover:bg-surface-sunken", s.id === supplierId && "bg-green-50 shadow-[inset_3px_0_0_var(--green-600)]")} data-testid="range-supplier-option" data-ref={s.ref}>
                <span className="font-mono text-xs text-muted-foreground">{s.ref}</span>
                <span className="min-w-0 flex-1"><span className="block truncate font-medium">{s.legalName}</span>{(s.cnName || s.city) && <span className="block truncate text-xs text-muted-foreground">{[s.cnName, s.city].filter(Boolean).join(" · ")}</span>}</span>
                <VerdictChip verdict={s.typeVerdict} />
              </button>
            </li>
          ))}
          {list.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted-foreground">No supplier matches.</li>}
        </ul>
      </section>
      <section className="flex flex-col rounded-xl border border-border bg-card p-5">
        <p className="eyebrow mb-1">02 · Client</p>
        <p className="mb-3 text-xs text-muted-foreground">The one client org this range is shown to. A second client gets a different label.</p>
        <Label htmlFor="range-org" className="mb-1.5 block text-xs font-medium text-ink-2">Client</Label>
        <Select value={orgId} onValueChange={setOrgId}>
          <SelectTrigger id="range-org" className="w-full" data-testid="range-org"><SelectValue placeholder="Choose a client" /></SelectTrigger>
          <SelectContent>{orgs.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}</SelectContent>
        </Select>
        <div className="mt-6 rounded-lg bg-section-alt px-3 py-2 text-sm text-ink-2">
          {chosen ? <>Range of <span className="font-medium text-foreground">{chosen.legalName}</span> <span className="font-mono text-xs">{chosen.ref}</span></> : "Pick a supplier"}{orgId && <> → shown to <span className="font-medium text-foreground">{orgs.find((o) => o.id === orgId)?.name}</span></>}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Next: upload the sanitised PDF and enter the items. The label “Factory F-nnnn” is assigned when an admin publishes.</p>
        <div className="mt-auto pt-6">
          <Button size="lg" className="w-full" disabled={!supplierId || !orgId || pending} data-testid="create-range" onClick={async () => {
            setPending(true);
            const r = await action({ supplierId, orgId });
            setPending(false);
            if (!r.ok) { toast.error(r.error); return; }
            toast.success(`Range ${r.data.ref} created — add the PDF and items`);
            router.push(`/ops/factory-ranges/${r.data.ref}`);
          }}>{pending && <Loader2 className="animate-spin" />}Create draft range</Button>
        </div>
      </section>
    </div>
  );
}
