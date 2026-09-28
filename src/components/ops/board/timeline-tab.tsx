"use client";
import * as React from "react";
import Link from "next/link";
import { Paperclip } from "lucide-react";
import type { OpsLine, OpsSample } from "@/server/ops/participations";
import { SAMPLE_PAID_BY } from "@/db/enums";
import { formatMoney } from "@/server/shared/money";
import { formatDate } from "@/server/shared/dates";
import { Timeline, type TimelineEntry } from "@/components/shared/timeline";
import { SampleStatusChip, ExceptionChip, VisibilityBadge } from "@/components/shared/chips";
import { FormShell } from "@/components/shared/form-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { addInternalNoteAction, askClientAction, replyToClientAction, postClientUpdateAction, logWhatsAppAction, setExceptionAction, clearExceptionAction, resolveChangeRequestAction, resolveQuestionAction, createSampleAction, setSampleStatusAction, uploadSamplePhotoAction, skipSampleAction, reSourceAction } from "@/app/(ops)/ops/lines/[ref]/actions";
import { S } from "./strings";
import { useAction } from "./use-action";
import { parseAmountMinor } from "./pure";

type Mode = "update" | "note" | "whatsapp" | "ask";
type Filter = (typeof S.timeline.filters)[number];

const Field = ({ label, children, className, error }: { label: React.ReactNode; children: React.ReactNode; className?: string; error?: string }) => (
  <div className={cn("flex flex-col gap-1.5", className)}><Label>{label}</Label>{children}{error && <p className="text-xs text-danger">{error}</p>}</div>
);

/** SPEC F-19 + F-20 — composer, filtered feed, exception controls, samples section. */
export function TimelineTab({ line }: { line: OpsLine }) {
  const [filter, setFilter] = React.useState<Filter>("All");
  const entries: TimelineEntry[] = line.feed
    .filter((f) => filter === "All" ? true : filter === "Client-visible" ? f.visibility === "client" : filter === "Internal" ? f.visibility === "internal" : filter === "WhatsApp" ? f.commentSource === "whatsapp_log" : f.isStateChange)
    .map((f) => ({
      id: f.id, at: f.at, visibility: f.visibility, author: f.actorName, counterparty: f.counterparty,
      kind: f.commentSource === "whatsapp_log" ? "whatsapp" : f.commentKind === "question" ? "question" : f.source === "comment" ? "note" : f.isActionMilestone ? "action_milestone" : f.isStateChange || f.type === "offer_sent" || f.type === "offer_decided" || f.type === "sample_decided" || f.type === "spec_frozen" ? "milestone" : f.type === "document_uploaded" || f.type === "document_published" ? "document" : "system",
      title: f.source === "comment" ? f.title : f.title, body: f.body ?? undefined, attachments: f.attachments,
      action: f.commentKind === "question" ? <ReplyButtons line={line} questionId={f.commentId} /> : undefined,
    }));

  return (
    <div className="flex flex-col gap-6" data-testid="timeline-tab">
      <Composer line={line} />
      <ExceptionControls line={line} />
      <section className="rounded-xl border border-border bg-card p-5">
        <div className="mb-4 flex flex-wrap items-center gap-2" role="tablist" aria-label="Feed filter">
          {S.timeline.filters.map((f) => (
            <button key={f} type="button" role="tab" aria-selected={filter === f} onClick={() => setFilter(f)} className={cn("h-7 rounded-full border px-3 text-xs font-medium transition-colors duration-[120ms]", filter === f ? "border-foreground bg-foreground text-white" : "border-border text-ink-2 hover:bg-surface-sunken")} data-testid={`filter-${f}`}>{f}</button>
          ))}
          <span className="ml-auto font-mono text-xs text-muted-foreground">{entries.length}</span>
        </div>
        <Timeline entries={entries} showVisibility emptyText={S.timeline.empty} />
      </section>
      <SamplesSection line={line} />
    </div>
  );
}

function Composer({ line }: { line: OpsLine }) {
  const { run, pending, errors } = useAction();
  const [mode, setMode] = React.useState<Mode>("update");
  const [body, setBody] = React.useState("");
  const [counterparty, setCounterparty] = React.useState("");
  const [occurredAt, setOccurredAt] = React.useState("");
  const [photoKind, setPhotoKind] = React.useState<"production_photo" | "sample_photo">("production_photo");
  const fileRef = React.useRef<HTMLInputElement>(null);
  const tabs: [Mode, string][] = [["update", S.timeline.clientUpdate], ["note", S.timeline.internalNote], ["whatsapp", S.timeline.whatsapp], ["ask", S.timeline.ask]];
  const submit = async () => {
    let r: unknown = null;
    if (mode === "note") r = await run(() => addInternalNoteAction({ lineId: line.id, body }), { success: "Internal note added" });
    else if (mode === "ask") r = await run(() => askClientAction({ lineId: line.id, body }), { success: "Question sent to the client" });
    else if (mode === "update") { const fd = new FormData(); fd.set("lineId", line.id); fd.set("body", body); fd.set("photoKind", photoKind); for (const f of fileRef.current?.files ?? []) fd.append("photos", f); r = await run(() => postClientUpdateAction(fd), { success: (d) => `Update published${d.photos ? ` with ${d.photos} photo${d.photos > 1 ? "s" : ""}` : ""}` }); }
    else { const fd = new FormData(); fd.set("lineId", line.id); fd.set("counterparty", counterparty); fd.set("body", body); fd.set("occurredAt", occurredAt ? `${occurredAt}T12:00:00Z` : ""); const f = fileRef.current?.files?.[0]; if (f) fd.set("screenshot", f); r = await run(() => logWhatsAppAction(fd), { success: "WhatsApp logged" }); }
    if (r) { setBody(""); setCounterparty(""); setOccurredAt(""); if (fileRef.current) fileRef.current.value = ""; }
  };
  return (
    <section className="rounded-xl border border-border bg-card p-5" id="whatsapp" data-testid="composer">
      <div className="mb-3 flex flex-wrap gap-4 border-b border-border" role="tablist">
        {tabs.map(([m, l]) => <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => setMode(m)} className={cn("-mb-px border-b-2 pb-2 text-sm", mode === m ? "border-green-600 font-semibold text-foreground" : "border-transparent text-ink-2 hover:text-foreground")} data-testid={`mode-${m}`}>{l}</button>)}
        <span className="ml-auto self-center"><VisibilityBadge visibility={mode === "update" || mode === "ask" ? "client" : "internal"} /></span>
      </div>
      {mode === "whatsapp" && (
        <div className="mb-3 grid gap-3 sm:grid-cols-2">
          <Field label={S.timeline.counterparty}><Input value={counterparty} onChange={(e) => setCounterparty(e.target.value)} placeholder="client / supplier name / other" data-testid="wa-counterparty" /></Field>
          <Field label={S.timeline.occurredAt}><Input type="date" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} className="font-mono" /></Field>
        </div>
      )}
      <Textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} data-testid="composer-body"
        placeholder={mode === "update" ? "Production photos from the line…" : mode === "note" ? "Internal — never shown to the client" : mode === "whatsapp" ? "Paste the conversation…" : "Which pocket colour?"} />
      {errors._ && <p className="mt-2 text-xs text-danger" data-testid="composer-error">{errors._}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {(mode === "update" || mode === "whatsapp") && (
          <label className="flex items-center gap-2 text-xs text-ink-2"><Paperclip className="size-3.5" />{mode === "update" ? S.timeline.photos : S.timeline.screenshot}
            <input ref={fileRef} type="file" accept="image/*" multiple={mode === "update"} className="text-xs" data-testid="composer-file" />
          </label>
        )}
        {mode === "update" && <select value={photoKind} onChange={(e) => setPhotoKind(e.target.value as never)} className="h-8 rounded-lg border border-input bg-card px-2 text-xs"><option value="production_photo">production photo</option><option value="sample_photo">sample photo</option></select>}
        <Button type="button" className="ml-auto" disabled={pending || !body.trim() || (mode === "whatsapp" && !counterparty.trim())} onClick={submit} data-testid="composer-post">{S.timeline.post}</Button>
      </div>
    </section>
  );
}

function ReplyButtons({ line, questionId }: { line: OpsLine; questionId: string | null }) {
  const { run, pending } = useAction();
  const [text, setText] = React.useState("");
  return (
    <div className="flex items-center gap-2">
      <FormShell trigger={<Button size="sm" variant="outline" data-testid="reply">{S.timeline.reply}</Button>} eyebrow={line.ref} title={S.timeline.reply} submitLabel={S.timeline.post} pending={pending}
        onSubmit={async () => { const r = await run(() => replyToClientAction({ lineId: line.id, body: text, questionId }), { success: "Reply sent" }); if (r) setText(""); return r ? undefined : false; }}>
        <Field label="Answer (client-visible, leak-checked)"><Textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} data-testid="reply-text" /></Field>
      </FormShell>
      {line.exception === "needs_input" && <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => resolveQuestionAction({ lineId: line.id }), { success: "Resolved" })}>{S.timeline.resolve}</Button>}
    </div>
  );
}

function ExceptionControls({ line }: { line: OpsLine }) {
  const { run, pending, errors } = useAction();
  const [reason, setReason] = React.useState("");
  const [choice, setChoice] = React.useState<"keep" | "negotiating" | "rfq_out" | "spec">("keep");
  const terminal = line.exception === "cancelled";
  return (
    <section className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-5 py-3 text-sm" data-testid="exception-controls">
      <span className="eyebrow mr-2">{S.timeline.exception}</span>
      {line.exception ? <><ExceptionChip exception={line.exception} />{line.exceptionReason && <span className="text-xs text-ink-2">— {line.exceptionReason}</span>}</> : <span className="text-xs text-muted-foreground">none</span>}
      <div className="ml-auto flex flex-wrap gap-2">
        {line.exception === "change_requested" && (
          <Dialog>
            <DialogTrigger asChild><Button size="sm" variant="outline" data-testid="resolve-change">{S.timeline.resolveChange}</Button></DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader><DialogTitle>{S.timeline.resolveChange}</DialogTitle><DialogDescription>{line.exceptionReason}</DialogDescription></DialogHeader>
              <div className="sheet">{S.timeline.resolveOptions.map(([v, l]) => <label key={v} className="sheet-row flex items-center gap-3 text-sm"><input type="radio" name="rc" className="accent-green-600" checked={choice === v} onChange={() => setChoice(v)} />{l}</label>)}</div>
              <DialogFooter><Button disabled={pending} onClick={() => run(() => resolveChangeRequestAction({ lineId: line.id, choice }), { success: "Change request resolved" })}>{S.common.confirm}</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        )}
        {line.exception && !terminal && line.exception !== "change_requested" && <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => clearExceptionAction({ lineId: line.id }), { success: "Flag cleared" })} data-testid="clear-exception">{line.exception === "on_hold" ? S.timeline.resume : S.timeline.clear}</Button>}
        {!line.exception && !line.order && (
          <>
            <FormShell trigger={<Button size="sm" variant="outline" data-testid="on-hold">{S.timeline.onHold}</Button>} eyebrow={line.ref} title={S.timeline.onHold} submitLabel={S.timeline.onHold} pending={pending}
              onSubmit={async () => { const r = await run(() => setExceptionAction({ lineId: line.id, exception: "on_hold", reason }), { success: "On hold" }); return r ? undefined : false; }}>
              <Field label={`${S.timeline.reason} (client-visible, leak-checked)`} error={errors.reason ?? errors._}><Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
            </FormShell>
            <FormShell trigger={<Button size="sm" variant="ghost" className="text-danger" data-testid="cancel-line">{S.timeline.cancel}</Button>} eyebrow={line.ref} title={S.timeline.cancel} submitLabel={S.timeline.cancel} submitVariant="destructive" pending={pending}
              onSubmit={async () => { const r = await run(() => setExceptionAction({ lineId: line.id, exception: "cancelled", reason }), { success: "Line cancelled" }); return r ? undefined : false; }}>
              <Field label={S.timeline.reason} error={errors.reason}><Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
            </FormShell>
          </>
        )}
      </div>
    </section>
  );
}

function SamplesSection({ line }: { line: OpsLine }) {
  const { run, pending, errors } = useAction();
  const [f, setF] = React.useState({ participationId: line.selectedParticipationId ?? "", cost: "45.00", currency: "USD", paidBy: "client", courier: "", tracking: "", deviations: "" });
  const [skipReason, setSkipReason] = React.useState("");
  const canSkip = line.state === "sampling" && !line.samples.some((s) => s.status === "received" || s.status === "approved");
  const canCreate = ["offer_ready", "offer_accepted", "sampling"].includes(line.state);
  return (
    <section className="rounded-xl border border-border bg-card p-5" id="samples" data-testid="samples-section">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">{S.timeline.samples}</h2>
        <div className="flex gap-2">
          {canSkip && (
            <FormShell trigger={<Button size="sm" variant="outline" data-testid="skip-sample">{S.timeline.skipSample}</Button>} eyebrow={line.ref} title={S.timeline.skipSample} submitLabel={S.timeline.skipSample} pending={pending}
              onSubmit={async () => { const r = await run(() => skipSampleAction({ lineId: line.id, reason: skipReason }), { success: "Sample skipped — offer accepted" }); return r ? undefined : false; }}>
              <Field label={`${S.timeline.reason} (≥ 5 chars)`} error={errors.reason ?? errors._}><Textarea rows={2} value={skipReason} onChange={(e) => setSkipReason(e.target.value)} data-testid="skip-reason" /></Field>
            </FormShell>
          )}
          {line.state === "sampling" && line.exception === "sample_rejected" && <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => reSourceAction({ lineId: line.id, to: "negotiating" }), { success: "Re-sourcing" })}>{S.timeline.reSource}</Button>}
          {canCreate && (
            <FormShell trigger={<Button size="sm" data-testid="new-sample">{S.timeline.newSample}</Button>} eyebrow={line.ref} title={S.timeline.newSample} submitLabel={S.timeline.newSample} pending={pending}
              onSubmit={async () => { const r = await run(() => createSampleAction({ lineId: line.id, participationId: f.participationId || null, costMinor: parseAmountMinor(f.cost), currency: f.currency, paidBy: (f.paidBy || null) as never, courier: f.courier || null, tracking: f.tracking || null, deviationsVsSpec: f.deviations || null }), { success: (d) => `${d.sampleRef} created` }); return r ? undefined : false; }}>
              <Field label="Supplier (ops-only)"><select value={f.participationId} onChange={(e) => setF({ ...f, participationId: e.target.value })} className="h-9 rounded-lg border border-input bg-card px-3 text-sm"><option value="">— selected supplier —</option>{line.participations.map((p) => <option key={p.id} value={p.id}>{p.supplier.legalName}</option>)}</select></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label={S.timeline.cost}><Input value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} inputMode="decimal" className="text-right font-mono" /></Field>
                <Field label={S.timeline.paidBy}><select value={f.paidBy} onChange={(e) => setF({ ...f, paidBy: e.target.value })} className="h-9 rounded-lg border border-input bg-card px-3 text-sm">{SAMPLE_PAID_BY.map((s) => <option key={s} value={s}>{s}</option>)}</select></Field>
                <Field label={S.timeline.courier}><Input value={f.courier} onChange={(e) => setF({ ...f, courier: e.target.value })} placeholder="DHL" /></Field>
                <Field label={S.timeline.tracking}><Input value={f.tracking} onChange={(e) => setF({ ...f, tracking: e.target.value })} className="font-mono" /></Field>
              </div>
              <Field label={S.timeline.deviations}><Textarea rows={2} value={f.deviations} onChange={(e) => setF({ ...f, deviations: e.target.value })} /></Field>
            </FormShell>
          )}
        </div>
      </div>
      {line.samples.length === 0 ? <p className="text-sm text-muted-foreground">{S.timeline.noSamples}</p> : (
        <ul className="sheet">{line.samples.map((s) => <SampleRow key={s.id} s={s} />)}</ul>
      )}
    </section>
  );
}

function SampleRow({ s }: { s: OpsSample }) {
  const { run, pending, errors } = useAction();
  const [tracking, setTracking] = React.useState(s.tracking ?? "");
  const [courier, setCourier] = React.useState(s.courier ?? "DHL");
  const [note, setNote] = React.useState("");
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = React.useState(false);
  return (
    <li className="sheet-row" data-testid="sample-row" data-sample={s.ref} data-status={s.status}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-mono text-xs">{s.ref}</span><SampleStatusChip status={s.status} />
        <span className="text-xs text-muted-foreground">{s.supplierName ?? "—"} · {s.costMinor !== null ? formatMoney({ minor: s.costMinor, currency: s.currency }) : "—"} paid by {s.paidBy ?? "—"}{s.paymentStatus ? ` (${s.paymentStatus})` : ""} · {s.courier ?? "—"} <span className="font-mono">{s.tracking ?? ""}</span></span>
        <span className="ml-auto font-mono text-xs text-muted-foreground">ordered {formatDate(s.orderedAt)}{s.shippedAt ? ` · shipped ${formatDate(s.shippedAt)}` : ""}{s.receivedAt ? ` · received ${formatDate(s.receivedAt)}` : ""}</span>
      </div>
      {(s.status === "approved" || s.status === "rejected") && <p className={cn("mt-1 text-xs", s.status === "approved" ? "text-success" : "text-danger")} data-testid="client-verdict">{S.timeline.clientVerdict}: {s.status} on {formatDate(s.decidedAt)}{s.rejectReason ? ` — “${s.rejectReason}”` : ""}</p>}
      {s.deviationsVsSpec && <p className="mt-1 text-xs text-ink-2">dev: {s.deviationsVsSpec} <VisibilityBadge visibility="internal" /></p>}
      {s.photos.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {s.photos.map((p) => (
            <a key={p.id} href={p.href} target="_blank" rel="noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.href} alt={p.filename} className="size-16 rounded-md border border-border object-cover" />
            </a>
          ))}
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {s.status === "ordered" && (
          <FormShell trigger={<Button size="sm" variant="outline" data-testid="mark-shipped">{S.timeline.markShipped}</Button>} eyebrow={s.ref} title={S.timeline.markShipped} submitLabel={S.timeline.markShipped} pending={pending}
            onSubmit={async () => { const r = await run(() => setSampleStatusAction({ sampleId: s.id, status: "shipped", courier: courier || null, tracking: tracking || null }), { success: "Sample shipped — client emailed" }); return r ? undefined : false; }}>
            <Field label={S.timeline.courier}><Input value={courier} onChange={(e) => setCourier(e.target.value)} /></Field>
            <Field label={S.timeline.tracking} error={errors.tracking}><Input value={tracking} onChange={(e) => setTracking(e.target.value)} className="font-mono" data-testid="ship-tracking" /></Field>
          </FormShell>
        )}
        {s.status === "shipped" && (
          <FormShell trigger={<Button size="sm" variant="outline" data-testid="mark-received">{S.timeline.markReceived}</Button>} eyebrow={s.ref} title={S.timeline.markReceived} submitLabel={S.timeline.markReceived} pending={pending}
            onSubmit={async () => { const r = await run(() => setSampleStatusAction({ sampleId: s.id, status: "received", noteToClient: note || null }), { success: "Sample received — client asked to decide" }); return r ? undefined : false; }}>
            <Field label={S.timeline.noteToClient}><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          </FormShell>
        )}
        {s.status !== "approved" && (
          <>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" data-testid="sample-photo-input" onChange={async (e) => { const file = e.target.files?.[0]; if (!file) return; setUploading(true); const fd = new FormData(); fd.set("sampleId", s.id); fd.set("file", file); await run(() => uploadSamplePhotoAction(fd), { success: "Photo published" }); setUploading(false); e.target.value = ""; }} />
            <Button size="sm" variant="ghost" disabled={uploading} onClick={() => fileRef.current?.click()}>{S.timeline.uploadPhoto}</Button>
          </>
        )}
        <Link href={`/app/samples/${s.ref}`} className="ml-auto text-xs text-muted-foreground hover:underline" target="_blank">client view →</Link>
      </div>
    </li>
  );
}
