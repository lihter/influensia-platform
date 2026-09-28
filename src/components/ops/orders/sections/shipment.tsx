"use client";
import * as React from "react";
import { Ship, Plane, TrainFront } from "lucide-react";
import type { OpsOrderDetail, OpsShipment } from "@/server/ops/orders";
import { SHIPMENT_MODES, FORWARDER_PARTIES, CUSTOMS_STATUSES } from "@/db/enums";
import { FormShell } from "@/components/shared/form-shell";
import { VisibilityBadge } from "@/components/shared/chips";
import { DateTime } from "@/components/shared/formatters";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { recordForwarderAction, markShippedAction, markDepartedAction, markArrivedAction, setCustomsStatusAction, markDeliveredAction, uploadShipmentDocumentAction } from "@/app/(ops)/ops/orders/actions";
import { OrderSection, useAct, DateField, TextField, SelectField, FileField, Checkbox, DetailRow, fd, str, opt } from "../ui";
import { SHIP_MODE, FORWARDER_PARTY, CUSTOMS } from "../strings";
import { today } from "@/server/shared/clock";

const ModeIcon = ({ mode }: { mode: string | null }) => (mode === "air" ? <Plane className="size-4" /> : mode === "rail" ? <TrainFront className="size-4" /> : <Ship className="size-4" />);
const customsTone = (s: string) => (s === "cleared" ? "success" : s === "held" ? "danger" : s === "in_progress" ? "info" : "neutral");

/** 06 Shipment — forwarder, booking, mode, container/AWB, cargo ready, ETD, ETA port, customs, delivered; B/L + packing list; the shipping transitions. */
export function ShipmentSection({ d }: { d: OpsOrderDetail }) {
  const o = d.order;
  const s = d.shipment;
  const { act, pending } = useAct();
  const stage = o.state;
  const action =
    stage === "awaiting_balance" ? <ForwarderSheet d={d} />
    : stage === "forwarder_booked" ? <ShippedSheet orderId={o.id} orderRef={o.ref} />
    : stage === "shipped_exworks" ? <DepartedSheet orderId={o.id} orderRef={o.ref} s={s} />
    : stage === "departed_origin" ? <span className="inline-flex gap-2"><ArrivedSheet orderId={o.id} orderRef={o.ref} /><DeliveredSheet orderId={o.id} orderRef={o.ref} ghost /></span>
    : stage === "eu_port_customs" ? <DeliveredSheet orderId={o.id} orderRef={o.ref} />
    : undefined;
  return (
    <OrderSection id="shipment" number={6} title="Shipment" action={action}>
      {!s ? (
        <p className="text-sm text-muted-foreground">Not shipped yet.{stage === "awaiting_balance" && !o.balancePaid && " Balance is pending — record it (or an admin override) before booking the forwarder."}</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2" data-testid="shipment">
          <dl className="text-sm">
            <DetailRow label="Mode" mono={false}><span className="inline-flex items-center gap-1.5"><ModeIcon mode={s.mode} />{s.mode ? SHIP_MODE[s.mode] : "—"}</span></DetailRow>
            <DetailRow label="Forwarder" mono={false}>{s.forwarder ?? "—"}{s.forwarderParty && <span className="ml-1 text-xs text-muted-foreground">· {FORWARDER_PARTY[s.forwarderParty]}</span>}</DetailRow>
            <DetailRow label="Booking ref">{s.bookingRef ?? "—"}</DetailRow>
            <DetailRow label="Container / AWB">{s.containerOrAwb ?? "—"}</DetailRow>
            <DetailRow label="Port of discharge" mono={false}>{s.portOfDischarge ?? "—"}</DetailRow>
            <DetailRow label="Customs" mono={false}>
              <span className="inline-flex items-center gap-2"><Badge variant={customsTone(s.customsStatus)}>{CUSTOMS[s.customsStatus]}</Badge>
                {(stage === "eu_port_customs" || stage === "departed_origin") && (
                  <select aria-label="Customs status" className="h-7 rounded-md border border-input bg-card px-1.5 text-xs" value={s.customsStatus} disabled={pending} onChange={(e) => act(() => setCustomsStatusAction({ orderId: o.id, customsStatus: e.target.value as (typeof CUSTOMS_STATUSES)[number] }), { success: "Customs status saved" })}>
                    {CUSTOMS_STATUSES.map((c) => <option key={c} value={c}>{CUSTOMS[c]}</option>)}
                  </select>
                )}
              </span>
            </DetailRow>
          </dl>
          <dl className="text-sm">
            <DetailRow label="Cargo ready"><DateTime value={s.cargoReady} /></DetailRow>
            <DetailRow label="Shipped ex-works"><DateTime value={s.exworksShippedAt} /></DetailRow>
            <DetailRow label="ETD"><DateTime value={s.etd} /></DetailRow>
            <DetailRow label="ETA port"><DateTime value={s.etaPort} /></DetailRow>
            <DetailRow label="Arrived"><DateTime value={s.arrivedPortAt} /></DetailRow>
            <DetailRow label="Delivered"><DateTime value={s.deliveredAt} /></DetailRow>
          </dl>
        </div>
      )}
      <div className="mt-4 grid gap-2 md:grid-cols-2">
        <ShipDoc label="Bill of lading" kind="bill_of_lading" doc={s?.bl ?? null} orderId={o.id} orderRef={o.ref} />
        <ShipDoc label="Packing list" kind="packing_list" doc={s?.packingList ?? null} orderId={o.id} orderRef={o.ref} />
      </div>
    </OrderSection>
  );
}

function ShipDoc({ label, kind, doc, orderId, orderRef }: { label: string; kind: "bill_of_lading" | "packing_list"; doc: OpsShipment["bl"]; orderId: string; orderRef: string }) {
  const { act } = useAct();
  return (
    <div className="flex items-center gap-3 rounded-lg bg-section-alt px-3 py-2 text-sm" data-testid={`shipdoc-${kind}`}>
      <div className="min-w-0 flex-1">
        <div className="text-2xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">{label}</div>
        {doc ? <a href={doc.downloadUrl} className="link truncate" download>{doc.filename}</a> : <span className="text-muted-foreground">not uploaded</span>}
      </div>
      {doc && <VisibilityBadge visibility={doc.visibility} />}
      <FormShell trigger={<Button size="sm" variant="ghost">{doc ? "Replace" : "Upload"}</Button>} eyebrow={orderRef} title={`Upload ${label.toLowerCase()}`} submitLabel="Upload"
        onSubmit={async (e) => { const f = fd(e); f.set("orderId", orderId); f.set("kind", kind); return act(() => uploadShipmentDocumentAction(f), { success: `${label} uploaded` }); }}>
        <FileField label={label} accept=".pdf,.txt,.md,.png,.jpg" required />
        <Checkbox name="publish" label="Publish to client now" hint="Runs the leak check on the filename and text layer." />
      </FormShell>
    </div>
  );
}

function ForwarderSheet({ d }: { d: OpsOrderDetail }) {
  const o = d.order;
  const s = d.shipment;
  const { act } = useAct();
  const [override, setOverride] = React.useState(false);
  return (
    <FormShell trigger={<Button size="sm" variant="outline" data-testid="record-forwarder">Record forwarder</Button>} eyebrow={o.ref} title="Record forwarder" description={o.balancePaid ? "Balance is paid — booking moves the order to Shipping." : "Balance not paid — only an admin can ship before balance, with a reason."} submitLabel="Book forwarder"
      onSubmit={async (e) => { const f = fd(e); return act(() => recordForwarderAction({ orderId: o.id, forwarder: str(f, "forwarder"), forwarderParty: str(f, "forwarderParty") as (typeof FORWARDER_PARTIES)[number], forwarderContact: opt(f, "forwarderContact"), bookingRef: str(f, "bookingRef"), cargoReady: str(f, "cargoReady"), mode: (opt(f, "mode") as (typeof SHIPMENT_MODES)[number] | null), portOfDischarge: opt(f, "portOfDischarge"), etaPort: opt(f, "etaPort"), overrideReason: override ? str(f, "overrideReason") : undefined }), { success: "Forwarder recorded" }); }}>
      <TextField name="forwarder" label="Forwarder" defaultValue={s?.forwarder} placeholder="Rohlig Suus" required autoFocus />
      <SelectField name="forwarderParty" label="Arranged by" defaultValue={s?.forwarderParty ?? "agency"} options={FORWARDER_PARTIES.map((p) => ({ value: p, label: FORWARDER_PARTY[p] }))} hint="Client's forwarder → the factory name appears on their documents; the supplier is marked as disclosed." />
      <TextField name="forwarderContact" label="Forwarder contact (internal)" defaultValue={s?.forwarderContact} />
      <TextField name="bookingRef" label="Booking ref" defaultValue={s?.bookingRef} required mono />
      <DateField name="cargoReady" label="Cargo ready" defaultValue={s?.cargoReady ?? o.exworksEta} required />
      <div className="grid grid-cols-2 gap-3">
        <SelectField name="mode" label="Mode" defaultValue={s?.mode ?? "sea"} options={SHIPMENT_MODES.map((m) => ({ value: m, label: SHIP_MODE[m] }))} />
        <TextField name="portOfDischarge" label="Port of discharge" defaultValue={s?.portOfDischarge} placeholder="Gdańsk" />
      </div>
      <DateField name="etaPort" label="Planned ETA port" defaultValue={s?.etaPort} />
      {!o.balancePaid && o.isAdmin && (
        <div className="rounded-lg border border-warning-border bg-warning-wash p-3">
          <label className="flex items-center gap-2 text-sm font-medium text-warning"><input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} className="accent-green-600" data-testid="ship-before-balance" />Ship before balance (admin)</label>
          {override && <div className="mt-2"><Textarea name="overrideReason" placeholder="Reason" required rows={2} /></div>}
        </div>
      )}
    </FormShell>
  );
}

function ShippedSheet({ orderId, orderRef }: { orderId: string; orderRef: string }) {
  const { act } = useAct();
  return (
    <FormShell trigger={<Button size="sm" variant="outline" data-testid="mark-shipped">Mark shipped ex-works</Button>} eyebrow={orderRef} title="Shipped ex-works" submitLabel="Mark shipped"
      onSubmit={async (e) => { const f = fd(e); return act(() => markShippedAction({ orderId, exworksShippedAt: str(f, "exworksShippedAt") }), { success: "Shipped ex-works" }); }}>
      <DateField name="exworksShippedAt" label="Shipped on" defaultValue={today()} required />
    </FormShell>
  );
}

function DepartedSheet({ orderId, orderRef, s }: { orderId: string; orderRef: string; s: OpsShipment | null }) {
  const { act } = useAct();
  return (
    <FormShell trigger={<Button size="sm" variant="outline" data-testid="mark-departed">Mark departed</Button>} eyebrow={orderRef} title="Departed origin" description="If the ETA differs from the planned one, the client gets an ETA update." submitLabel="Confirm departure"
      onSubmit={async (e) => { const f = fd(e); return act(() => markDepartedAction({ orderId, mode: str(f, "mode") as (typeof SHIPMENT_MODES)[number], containerOrAwb: str(f, "containerOrAwb"), etd: str(f, "etd"), etaPort: str(f, "etaPort"), portOfDischarge: opt(f, "portOfDischarge") }), { success: "Departed origin" }); }}>
      <SelectField name="mode" label="Mode" defaultValue={s?.mode ?? "sea"} options={SHIPMENT_MODES.map((m) => ({ value: m, label: SHIP_MODE[m] }))} />
      <TextField name="containerOrAwb" label="Container / AWB" defaultValue={s?.containerOrAwb} placeholder="MSKU4471021" required mono />
      <div className="grid grid-cols-2 gap-3">
        <DateField name="etd" label="ETD" defaultValue={s?.etd ?? today()} required />
        <DateField name="etaPort" label="ETA port" defaultValue={s?.etaPort} required />
      </div>
      <TextField name="portOfDischarge" label="Port of discharge" defaultValue={s?.portOfDischarge} />
    </FormShell>
  );
}

function ArrivedSheet({ orderId, orderRef }: { orderId: string; orderRef: string }) {
  const { act } = useAct();
  return (
    <FormShell trigger={<Button size="sm" variant="outline" data-testid="mark-arrived">Arrived at port</Button>} eyebrow={orderRef} title="Arrived at port" submitLabel="Mark arrived"
      onSubmit={async (e) => { const f = fd(e); return act(() => markArrivedAction({ orderId, arrivedPortAt: str(f, "arrivedPortAt") }), { success: "Arrived — customs in progress" }); }}>
      <DateField name="arrivedPortAt" label="Arrived on" defaultValue={today()} required />
    </FormShell>
  );
}

function DeliveredSheet({ orderId, orderRef }: { orderId: string; orderRef: string; ghost?: boolean }) {
  const { act } = useAct();
  return (
    <FormShell trigger={<Button size="sm" variant="outline" data-testid="mark-delivered">Mark delivered</Button>} eyebrow={orderRef} title="Mark delivered" description="The client is asked to confirm delivery." submitLabel="Confirm delivered"
      onSubmit={async (e) => { const f = fd(e); return act(() => markDeliveredAction({ orderId, deliveredAt: str(f, "deliveredAt") }), { success: "Delivered — client asked to confirm" }); }}>
      <DateField name="deliveredAt" label="Delivered on" defaultValue={today()} required />
    </FormShell>
  );
}
