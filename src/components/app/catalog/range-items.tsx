"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, ImageOff, Check, AlertCircle } from "lucide-react";
import type { ClientRangeDto, ClientRangeRequestDto } from "@/server/client/dto/ranges";
import type { ActionResult } from "@/server/shared/http";
import { formatQty } from "@/server/shared/money";
import { UnitPrice } from "@/components/shared/formatters";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { label, unitLabel } from "@/lib/labels";
import { perUnit } from "../client-format";

type Action = (i: { rangeId: string; items: { itemId: string; qty: number }[]; note?: string | null }) => Promise<ActionResult<ClientRangeRequestDto>>;

/**
 * DESIGN §6.5 range items: compact sheet list (thumbnail · name · MOQ · indicative price) with a Select column and a
 * quantity input per selected row; "Request these items" sits in a sticky bar (bottom on phone). Client DTO only.
 */
export function RangeItems({ range, action }: { range: ClientRangeDto; action: Action }) {
  const router = useRouter();
  const [sel, setSel] = React.useState<Record<string, string>>({});
  const [note, setNote] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const toggle = (id: string, moq: number | null) => setSel((s) => { const n = { ...s }; if (n[id] !== undefined) delete n[id]; else n[id] = String(moq ?? 1); return n; });
  const count = Object.keys(sel).length;
  const submit = async () => {
    setError(null);
    const items = Object.entries(sel).map(([itemId, q]) => ({ itemId, qty: Number(q) }));
    if (!items.length) { setError("Select at least one item"); return; }
    if (items.some((i) => !Number.isInteger(i.qty) || i.qty <= 0)) { setError("Every selected item needs a whole-number quantity"); return; }
    setPending(true);
    const r = await action({ rangeId: range.id, items, note: note || null });
    setPending(false);
    if (!r.ok) { setError(r.errors ? Object.values(r.errors).join(" · ") : "Something went wrong — please try again"); return; }
    toast.success(`Request ${r.data.requestRef} sent — ${r.data.lineRefs.length} ${r.data.lineRefs.length === 1 ? "item" : "items"} from Factory ${r.data.factoryLabel}`, { description: "Prices are being confirmed — you'll get an offer, no new sourcing round." });
    router.push("/app/requests");
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-4 pb-24 lg:pb-0">
      <ul className="sheet" data-testid="range-items">
        {range.items.map((it) => {
          const on = sel[it.id] !== undefined;
          return (
            <li key={it.id} className={cn("sheet-row flex flex-wrap items-center gap-3 transition-colors duration-[120ms] sm:flex-nowrap", on && "bg-green-50 shadow-[inset_3px_0_0_var(--green-600)]")} data-testid="range-item" data-selected={on || undefined}>
              <label className="flex cursor-pointer items-center gap-3">
                <input type="checkbox" className="size-4 rounded-sm accent-green-600" checked={on} onChange={() => toggle(it.id, it.moq)} aria-label={`Select ${it.name}`} />
                <span className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-section-alt">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {it.image ? <img src={it.image.url} alt="" className="size-full object-cover" loading="lazy" /> : <ImageOff className="size-4 text-muted-foreground" strokeWidth={1.75} />}
                </span>
              </label>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground [overflow-wrap:anywhere]">{it.name}</p>
                <p className="text-xs text-ink-2 sm:hidden">{it.price ? <>from <UnitPrice minorE2={it.price.minorE2} currency={it.price.currency} unit={perUnit(it.unit)} className="text-xs" /> · to be confirmed</> : "price on request"}</p>
                <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                  {it.moqLabel && <span className="font-mono">{it.moqLabel}</span>}
                  {it.madeHere === true && <Badge variant="success" className="normal-case tracking-normal"><Check className="size-3" />{label("provenance", "made_here")}</Badge>}
                  {it.madeHere === false && <Badge variant="neutral" className="normal-case tracking-normal">{label("provenance", "sourced_by_them")}</Badge>}
                  {it.note && <span>{it.note}</span>}
                </p>
              </div>
              <div className="hidden text-right text-sm sm:block">
                {it.price ? <><span className="text-xs text-muted-foreground">from </span><UnitPrice minorE2={it.price.minorE2} currency={it.price.currency} unit={perUnit(it.unit)} /><p className="text-2xs text-muted-foreground">to be confirmed</p></> : <span className="text-xs text-muted-foreground">price on request</span>}
              </div>
              <div className={cn("relative w-full sm:w-36", !on && "max-sm:hidden sm:invisible")}>
                <Input inputMode="numeric" value={sel[it.id] ?? ""} onChange={(e) => setSel((s) => ({ ...s, [it.id]: e.target.value.replace(/[^\d]/g, "") }))} className="h-9 pr-12 text-right font-mono" aria-label={`Quantity for ${it.name}`} />
                <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 font-mono text-xs text-muted-foreground">{unitLabel(it.unit)}</span>
              </div>
            </li>
          );
        })}
      </ul>
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur-sm lg:static lg:rounded-xl lg:border lg:bg-card lg:p-5" data-testid="range-request-bar">
        <div className="mx-auto flex max-w-[72rem] flex-col gap-3 sm:flex-row sm:items-start">
          <div className="min-w-0 flex-1">
            <p className="text-sm text-ink-2"><span className="font-mono font-medium text-foreground">{count}</span> {count === 1 ? "item" : "items"} selected{count > 0 && <> · {Object.entries(sel).map(([id, q]) => { const it = range.items.find((x) => x.id === id); return it && q ? `${formatQty(Number(q))} × ${it.name}` : null; }).filter(Boolean).slice(0, 3).join(", ")}{count > 3 ? "…" : ""}</>}</p>
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything we should know? (optional)" className="mt-2 hidden lg:block" />
            {error && <p className="mt-1 flex items-center gap-1 text-xs text-danger" role="alert"><AlertCircle className="size-3" />{error}</p>}
          </div>
          <Button size="lg" variant="action" className="w-full sm:w-auto" disabled={pending || count === 0} onClick={submit} data-testid="request-items">{pending && <Loader2 className="animate-spin" />}Request these items</Button>
        </div>
      </div>
    </div>
  );
}
