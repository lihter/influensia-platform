"use client";
import * as React from "react";
import type { OpsOrderDetail, OpsInspection } from "@/server/ops/orders";
import { INSPECTION_RESULTS } from "@/db/enums";
import { FormShell } from "@/components/shared/form-shell";
import { VisibilityBadge } from "@/components/shared/chips";
import { DateTime, Ref } from "@/components/shared/formatters";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { scheduleInspectionAction, recordInspectionAction, setInspectionVisibilityAction } from "@/app/(ops)/ops/orders/actions";
import { OrderSection, useAct, DateField, TextField, TextareaField, SelectField, FileField, Checkbox, fd, str, opt, num } from "../ui";
import { INSPECTION_RESULT } from "../strings";
import { today } from "@/server/shared/clock";

const tone = (r: string | null) => (r === "pass" ? "success" : r === "fail" ? "danger" : r === "rework" ? "warning" : "outline");

/** 05 Inspection — rows: PO · inspector · date · AQL · sample · result chip · report (visibility badge) · visible_to_client toggle. Schedule / Record result. */
export function InspectionSection({ d }: { d: OpsOrderDetail }) {
  const o = d.order;
  const pendingInsp = d.inspections.filter((i) => !i.result);
  const canSchedule = o.state === "in_production" || o.state === "qc_inspection";
  return (
    <OrderSection id="inspection" number={5} title="Inspection" count={pendingInsp.length} action={canSchedule ? <ScheduleSheet orderId={o.id} orderRef={o.ref} label={o.exception === "qc_failed" ? "Schedule re-inspection" : "Schedule inspection"} /> : undefined}>
      {d.inspections.length === 0 ? (
        <p className="text-sm text-muted-foreground">Inspection not scheduled yet.</p>
      ) : (
        <ul className="sheet">
          {d.inspections.map((i) => <InspectionRow key={i.id} i={i} orderId={o.id} orderRef={o.ref} />)}
        </ul>
      )}
      {o.exception === "qc_failed" && <p className="mt-3 text-xs text-warning">QC failed — the order is back in production; schedule a re-inspection when the rework is done.</p>}
    </OrderSection>
  );
}

function InspectionRow({ i, orderId, orderRef }: { i: OpsInspection; orderId: string; orderRef: string }) {
  const { act, pending } = useAct();
  return (
    <li className="sheet-row grid gap-3 md:grid-cols-[1fr_auto]" data-testid="inspection-row" data-result={i.result ?? "pending"}>
      <div className="min-w-0 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={tone(i.result)}>{i.result ? INSPECTION_RESULT[i.result] : "Scheduled"}</Badge>
          {i.poRef && <Ref muted>{i.poRef}</Ref>}
          {i.inspector && <span className="text-ink-2">{i.inspector}</span>}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
          <span>Scheduled <DateTime value={i.scheduledFor} /></span>
          {i.inspectedAt && <span>Inspected <DateTime value={i.inspectedAt} /></span>}
          {i.aql && <span>AQL <span className="font-mono">{i.aql}</span></span>}
          {i.sampleSize !== null && <span>Sample <span className="font-mono">{i.sampleSize}</span></span>}
        </div>
        {i.defectsNote && <p className="mt-1 text-xs text-ink-2">{i.defectsNote}</p>}
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          {i.report ? <><a href={i.report.downloadUrl} className="link" download>{i.report.filename}</a><VisibilityBadge visibility={i.report.visibility} />{i.report.visibility === "internal" && <a href="#documents" className="text-muted-foreground hover:underline">publish in 07 Documents</a>}</> : <span className="text-muted-foreground">no report</span>}
          <label className="ml-auto flex items-center gap-1.5 text-xs text-ink-2"><input type="checkbox" checked={i.visibleToClient} disabled={pending} onChange={(e) => act(() => setInspectionVisibilityAction({ inspectionId: i.id, visible: e.target.checked }), { success: e.target.checked ? "Result visible to client" : "Result hidden from client" })} className="accent-green-600" data-testid="visible-to-client" />Show report to client</label>
        </div>
      </div>
      <div className="flex items-start gap-2">
        {!i.result && <RecordSheet i={i} orderRef={orderRef} />}
        {!i.result && <ScheduleSheet orderId={orderId} inspectionId={i.id} orderRef={orderRef} label="Edit" defaults={i} ghost />}
      </div>
    </li>
  );
}

function ScheduleSheet({ orderId, inspectionId, orderRef, label, defaults, ghost }: { orderId: string; inspectionId?: string; orderRef: string; label: string; defaults?: OpsInspection; ghost?: boolean }) {
  const { act } = useAct();
  return (
    <FormShell trigger={<Button size="sm" variant={ghost ? "ghost" : "default"} data-testid={ghost ? "edit-inspection" : "schedule-inspection"}>{label}</Button>} eyebrow={orderRef} title={label} submitLabel="Save"
      onSubmit={async (e) => { const f = fd(e); return act(() => scheduleInspectionAction({ orderId, inspectionId, scheduledFor: str(f, "scheduledFor"), inspector: opt(f, "inspector"), aql: opt(f, "aql"), sampleSize: num(f, "sampleSize") }), { success: "Inspection scheduled" }); }}>
      <DateField name="scheduledFor" label="Scheduled for" defaultValue={defaults?.scheduledFor} required />
      <TextField name="inspector" label="Inspector" defaultValue={defaults?.inspector} placeholder="Cristina" />
      <div className="grid grid-cols-2 gap-3">
        <TextField name="aql" label="AQL" defaultValue={defaults?.aql} placeholder="2.5" mono />
        <TextField name="sampleSize" label="Sample size" type="number" defaultValue={defaults?.sampleSize?.toString()} placeholder="125" mono min="1" />
      </div>
    </FormShell>
  );
}

function RecordSheet({ i, orderRef }: { i: OpsInspection; orderRef: string }) {
  const { act } = useAct();
  const [result, setResult] = React.useState<(typeof INSPECTION_RESULTS)[number]>("pass");
  return (
    <FormShell trigger={<Button size="sm" data-testid="record-inspection">Record result</Button>} eyebrow={orderRef} title="Record inspection result" description="Pass → balance invoice due in 3 working days, client emailed. Fail / rework → back to production with a “rework in progress” flag." submitLabel="Record"
      onSubmit={async (e) => { const f = fd(e); f.set("inspectionId", i.id); return act(() => recordInspectionAction(f), { success: result === "pass" ? "QC passed — balance due" : "Recorded — rework in progress" }); }}>
      <SelectField name="result" label="Result" value={result} onChange={setResult} options={INSPECTION_RESULTS.map((r) => ({ value: r, label: INSPECTION_RESULT[r] }))} />
      <DateField name="inspectedAt" label="Inspected on" defaultValue={today()} required />
      <div className="grid grid-cols-2 gap-3">
        <TextField name="aql" label="AQL" defaultValue={i.aql} mono />
        <TextField name="sampleSize" label="Sample size" type="number" defaultValue={i.sampleSize?.toString()} mono min="1" />
      </div>
      <TextareaField name="defectsNote" label="Findings (client-visible on pass)" placeholder="0 critical, 2 minor" rows={2} />
      <FileField label="Report (stored internal — publish from 07 Documents)" accept=".pdf,.txt,.md,.png,.jpg" />
      <Checkbox name="visibleToClient" label="Show result to client" defaultChecked hint="The report file stays internal until you publish it." />
    </FormShell>
  );
}
