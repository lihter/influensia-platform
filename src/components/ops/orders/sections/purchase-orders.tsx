"use client";
import * as React from "react";
import Link from "next/link";
import { Pencil } from "lucide-react";
import type { OpsOrderDetail, OpsPurchaseOrder } from "@/server/ops/orders";
import { PO_STATUSES } from "@/db/enums";
import { FormShell } from "@/components/shared/form-shell";
import { FactoryLabel } from "@/components/shared/factory-label";
import { VisibilityBadge } from "@/components/shared/chips";
import { Money, DateTime, Ref } from "@/components/shared/formatters";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { setPoEtaAction, updatePoAction, startProductionAction } from "@/app/(ops)/ops/orders/actions";
import { OrderSection, useAct, DateField, TextField, SelectField, fd, str, opt, minor, DetailRow } from "../ui";
import { PO_STATUS } from "../strings";

const tone = (s: string) => (s === "completed" ? "success" : s === "in_production" ? "info" : s === "cancelled" ? "danger" : s === "issued" ? "outline" : "neutral");

/** 04 Purchase orders — one card row per supplier: name + SUP ref + F-label, PO ref, factory total, terms, ex-works ETA (editable → eta_changed), status. */
export function PurchaseOrdersSection({ d }: { d: OpsOrderDetail }) {
  const o = d.order;
  const canStart = (o.state === "awaiting_artwork" || o.state === "awaiting_deposit");
  const open = d.purchaseOrders.filter((p) => !p.exworksEta).length;
  return (
    <OrderSection id="purchase-orders" number={4} title="Purchase orders" count={open} action={canStart ? <StartProductionSheet orderId={o.id} orderRef={o.ref} defaultEta={o.exworksEta} /> : undefined}>
      <ul className="sheet">
        {d.purchaseOrders.length === 0 && <li className="sheet-row text-sm text-muted-foreground">No purchase orders.</li>}
        {d.purchaseOrders.map((po) => <PoRow key={po.id} po={po} orderRef={o.ref} />)}
      </ul>
    </OrderSection>
  );
}

function PoRow({ po, orderRef }: { po: OpsPurchaseOrder; orderRef: string }) {
  return (
    <li className="sheet-row grid gap-3 md:grid-cols-[1fr_1fr]" data-testid="po-row" data-ref={po.ref}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">{po.supplierName}</span>
          <Link href={`/ops/suppliers/${po.supplierRef}`} className="font-mono text-xs text-muted-foreground hover:underline">{po.supplierRef}</Link>
          {po.factoryLabel && <FactoryLabel label={po.factoryLabel} disclosed={po.disclosed} />}
          <Badge variant={tone(po.status)}>{PO_STATUS[po.status]}</Badge>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-2">
          <Ref>{po.ref}</Ref>
          {po.contactName && <span>{po.contactName}</span>}
          <span>lines {po.lineRefs.map((r) => r.slice(-2)).join(", ")}</span>
          {po.document ? <a href={po.document.downloadUrl} className="link" download>{po.document.filename}</a> : <span className="text-muted-foreground">no PO document</span>}
          {po.document && <VisibilityBadge visibility={po.document.visibility} />}
        </div>
      </div>
      <dl className="text-sm">
        <DetailRow label="Factory total"><Money minor={po.factoryTotalMinor} currency={po.currency} strong /></DetailRow>
        <DetailRow label="Terms" mono={false}>{po.terms ?? <span className="text-muted-foreground">—</span>}</DetailRow>
        <DetailRow label="Ex-works ETA">
          <span className="inline-flex items-center gap-2">
            {po.exworksEta ? <DateTime value={po.exworksEta} /> : <span className="text-muted-foreground">not set</span>}
            <EtaSheet po={po} orderRef={orderRef} />
          </span>
        </DetailRow>
        <DetailRow label="Issued">{po.issuedAt ? <DateTime value={po.issuedAt} variant="short" /> : <EditPoSheet po={po} orderRef={orderRef} />}</DetailRow>
      </dl>
    </li>
  );
}

function EtaSheet({ po, orderRef }: { po: OpsPurchaseOrder; orderRef: string }) {
  const { act } = useAct();
  return (
    <FormShell trigger={<Button size="icon-xs" variant="ghost" aria-label="Edit ex-works ETA" data-testid="edit-eta"><Pencil /></Button>} eyebrow={`${orderRef} · ${po.ref}`} title="Ex-works ETA" description="Once the order is in production, changing the ETA emails the client (ETA update)." submitLabel="Save ETA"
      onSubmit={async (e) => { const f = fd(e); return act(() => setPoEtaAction({ poId: po.id, exworksEta: str(f, "exworksEta") }), { success: "ETA saved" }); }}>
      <DateField name="exworksEta" label="Ex-works ETA" defaultValue={po.exworksEta} required />
    </FormShell>
  );
}

function EditPoSheet({ po, orderRef }: { po: OpsPurchaseOrder; orderRef: string }) {
  const { act } = useAct();
  return (
    <FormShell trigger={<Button size="sm" variant="outline">Edit / issue</Button>} eyebrow={`${orderRef} · ${po.ref}`} title="Purchase order" submitLabel="Save"
      onSubmit={async (e) => { const f = fd(e); return act(() => updatePoAction({ poId: po.id, terms: opt(f, "terms"), factoryTotalMinor: minor(f, "factoryTotal"), status: str(f, "status") as (typeof PO_STATUSES)[number] }), { success: "PO saved" }); }}>
      <TextField name="factoryTotal" label="Factory total (USD)" defaultValue={(po.factoryTotalMinor / 100).toFixed(2)} mono required />
      <TextField name="terms" label="Terms" defaultValue={po.terms} placeholder="T/T 30/70" />
      <SelectField name="status" label="Status" defaultValue={po.status} options={PO_STATUSES.map((s) => ({ value: s, label: PO_STATUS[s] }))} />
    </FormShell>
  );
}

function StartProductionSheet({ orderId, orderRef, defaultEta }: { orderId: string; orderRef: string; defaultEta: string | null }) {
  const { act } = useAct();
  return (
    <FormShell trigger={<Button size="sm" data-testid="start-production">Start production</Button>} eyebrow={orderRef} title="Start production" description="Requires deposit + fee paid and every required artwork approved. Sets the ex-works ETA on every PO and emails the client." submitLabel="Start production"
      onSubmit={async (e) => { const f = fd(e); return act(() => startProductionAction({ orderId, exworksEta: str(f, "exworksEta") }), { success: "In production" }); }}>
      <DateField name="exworksEta" label="Ex-works ETA" defaultValue={defaultEta} required />
    </FormShell>
  );
}
