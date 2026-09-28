"use client";
import * as React from "react";
import { useTranslations } from "next-intl";
import { Search, Plus, Trash2 } from "lucide-react";
import type { OpsLine, OpsParticipation } from "@/server/ops/participations";
import type { ParticipationStatus } from "@/db/enums";
import { CONTACT_CHANNELS, INCOTERMS, UNITS, PARTICIPATION_STATUSES } from "@/db/enums";
import { formatUnitPrice } from "@/server/shared/money";
import { FormShell } from "@/components/shared/form-shell";
import { ParticipationChip } from "@/components/shared/chips";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { searchSuppliersAction, addParticipationAction, setParticipationStatusAction, updateParticipationAction, logQuoteAction, previewNormalisationAction, markRfqSentAction, shortlistAction } from "@/app/(ops)/ops/lines/[ref]/actions";
import { S, CHANNEL_LABEL } from "./strings";
import { useAction } from "./use-action";
import { parsePriceE2, e2ToText, REASON_REQUIRED } from "./pure";

type SupplierHit = Extract<Awaited<ReturnType<typeof searchSuppliersAction>>, { ok: true }>["data"][number];

const Field = ({ label, children, className, error }: { label: string; children: React.ReactNode; className?: string; error?: string }) => (
  <div className={cn("flex flex-col gap-1.5", className)}><Label>{label}</Label>{children}{error && <p className="text-xs text-danger">{error}</p>}</div>
);
const Sel = (p: React.ComponentProps<"select">) => <select {...p} className={cn("h-9 rounded-lg border border-input bg-card px-3 text-sm", p.className)} />;

/* ───────── + Supplier ───────── */
export function AddSupplierSheet({ line, open, onOpenChange }: { line: OpsLine; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { run, pending, errors } = useAction();
  const [q, setQ] = React.useState("");
  const [results, setResults] = React.useState<SupplierHit[]>([]);
  const [picked, setPicked] = React.useState<{ id: string; contactId: string | null; name: string } | null>(null);
  const [create, setCreate] = React.useState(false);
  const [c, setC] = React.useState({ legalName: "", cnName: "", city: "", contactName: "", channel: "alibaba", handle: "", phone: "" });
  const [notes, setNotes] = React.useState("");
  React.useEffect(() => {
    const t = setTimeout(async () => {
      if (!q.trim()) { setResults([]); return; }
      const r = await searchSuppliersAction({ q, lineId: line.id });
      if (r.ok) setResults(r.data);
    }, 200);
    return () => clearTimeout(t);
  }, [q, line.id]);
  const change = (o: boolean) => { if (!o) { setQ(""); setPicked(null); setCreate(false); setNotes(""); } onOpenChange(o); };
  return (
    <FormShell open={open} onOpenChange={change} eyebrow={line.ref} title={S.board.addSupplier} submitLabel={S.board.addSupplier} pending={pending}
      onSubmit={async () => {
        const r = await run(() => addParticipationAction(create
          ? { lineId: line.id, notes: notes || null, create: { legalName: c.legalName, cnName: c.cnName || null, city: c.city || null, contactName: c.contactName || null, channel: c.channel as never, handle: c.handle || null, phone: c.phone || null } }
          : { lineId: line.id, supplierId: picked?.id, contactId: picked?.contactId ?? null, notes: notes || null }), { success: (d) => `Added ${d.supplierRef}` });
        return r ? undefined : false;
      }}>
      {!create && (
        <>
          <Field label={S.board.search} error={errors.supplierId}>
            <div className="relative"><Search className="pointer-events-none absolute inset-y-0 left-3 my-auto size-4 text-muted-foreground" /><Input value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" placeholder="yuan…" autoFocus data-testid="supplier-search" /></div>
          </Field>
          <div className="sheet max-h-72 overflow-auto" data-testid="supplier-results">
            {results.length === 0 && <p className="px-4 py-3 text-xs text-muted-foreground">{q ? "No match." : "Type to search the supplier database."}</p>}
            {results.map((s) => (
              <button type="button" key={s.id} disabled={s.onLine} onClick={() => setPicked({ id: s.id, contactId: s.contacts[0]?.id ?? null, name: s.legalName })}
                className={cn("sheet-row flex w-full flex-col items-start gap-0.5 text-left hover:bg-surface-sunken disabled:opacity-50", picked?.id === s.id && "bg-green-50")} data-testid="supplier-result">
                <span className="text-sm font-medium">{s.legalName} {s.cnName && <span className="text-xs text-muted-foreground">{s.cnName}</span>}</span>
                <span className="font-mono text-2xs text-muted-foreground">{s.ref} · {s.typeVerdict} · {s.grade ?? "—"} · {s.city ?? "—"}{s.onLine ? ` · ${S.board.alreadyOnLine}` : ""}</span>
                {s.contacts.length > 0 && <span className="text-2xs text-ink-2">{s.contacts.map((ct) => `${ct.name ?? "—"} · ${CHANNEL_LABEL[ct.channel]}`).join(" / ")}</span>}
              </button>
            ))}
          </div>
          {picked && <p className="text-xs text-success">Selected: {picked.name}</p>}
          <Button type="button" variant="ghost" size="sm" className="self-start" onClick={() => setCreate(true)}><Plus data-icon="inline-start" />{S.board.orCreate}</Button>
        </>
      )}
      {create && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={S.board.legalName} className="sm:col-span-2"><Input value={c.legalName} onChange={(e) => setC({ ...c, legalName: e.target.value })} required data-testid="create-legal-name" /></Field>
          <Field label={S.board.cnName}><Input value={c.cnName} onChange={(e) => setC({ ...c, cnName: e.target.value })} /></Field>
          <Field label={S.board.city}><Input value={c.city} onChange={(e) => setC({ ...c, city: e.target.value })} /></Field>
          <Field label={S.board.contactName}><Input value={c.contactName} onChange={(e) => setC({ ...c, contactName: e.target.value })} /></Field>
          <Field label={S.board.channel}><Sel value={c.channel} onChange={(e) => setC({ ...c, channel: e.target.value })}>{CONTACT_CHANNELS.map((ch) => <option key={ch} value={ch}>{CHANNEL_LABEL[ch]}</option>)}</Sel></Field>
          <Field label={S.board.handle}><Input value={c.handle} onChange={(e) => setC({ ...c, handle: e.target.value })} /></Field>
          <Field label={S.board.phone}><Input value={c.phone} onChange={(e) => setC({ ...c, phone: e.target.value })} /></Field>
          <Button type="button" variant="ghost" size="sm" className="justify-self-start" onClick={() => setCreate(false)}>← search instead</Button>
        </div>
      )}
      <Field label={`${S.board.col.notes} ${S.common.optional}`}><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
    </FormShell>
  );
}

/* ───────── Log quote ───────── */
type BreakRow = { minQty: string; price: string };
export function LogQuoteSheet({ line, participation, open, onOpenChange }: { line: OpsLine; participation: OpsParticipation | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { run, pending, errors } = useAction();
  const [pid, setPidState] = React.useState(participation?.id ?? "");
  const blank = { currency: "USD", unit: line.unit, packQty: "", incoterm: "FOB", uncertain: false, port: "", moq: "", lead: "", leadMax: "", valid: "", terms: "", deviations: "", weight: "", carton: "", notes: "", received: new Date().toISOString().slice(0, 10) };
  /** Prefill the terms from the participation's latest quote (values are re-entered by hand — extraction is v1.1). */
  const prefill = (id: string) => {
    const prev = line.participations.find((p) => p.id === id)?.latestQuote ?? null;
    return prev ? { ...blank, currency: prev.currency, unit: prev.unit, packQty: prev.packQty ? String(prev.packQty) : "", incoterm: prev.incoterm ?? "FOB", uncertain: prev.incotermUncertain, port: prev.port ?? "", moq: prev.moq ? String(prev.moq) : "", lead: prev.leadDays ? String(prev.leadDays) : "", leadMax: prev.leadDaysMax ? String(prev.leadDaysMax) : "", terms: prev.paymentTerms ?? "" } : blank;
  };
  const [f, setF] = React.useState(() => prefill(participation?.id ?? ""));
  const setPid = (id: string) => { setPidState(id); setF(prefill(id)); };
  const [breaks, setBreaks] = React.useState<BreakRow[]>([{ minQty: line.qty ? String(line.qty) : "", price: "" }]);
  const [file, setFile] = React.useState<File | null>(null);
  const [preview, setPreview] = React.useState<{ usdMinorE2: number | null; flags: string[]; fxRate: number | null; fxDate: string | null } | null>(null);
  const parsedBreaks = breaks.map((b) => ({ minQty: Number(b.minQty), unitPriceMinorE2: parsePriceE2(b.price) ?? 0 })).filter((b) => b.minQty > 0 && b.unitPriceMinorE2 > 0);
  const breaksKey = JSON.stringify(parsedBreaks);
  React.useEffect(() => {
    const t = setTimeout(async () => {
      const bs = JSON.parse(breaksKey) as { minQty: number; unitPriceMinorE2: number }[];
      if (!bs.length || !open) { setPreview(null); return; }
      const r = await previewNormalisationAction({ lineId: line.id, currency: f.currency, unit: f.unit, packQty: f.packQty ? Number(f.packQty) : null, breaks: bs });
      if (r.ok) setPreview(r.data);
    }, 250);
    return () => clearTimeout(t);
  }, [breaksKey, f.currency, f.unit, f.packQty, open, line.id]);
  const unitMismatch = f.unit !== line.unit && !f.packQty;
  return (
    <FormShell open={open} onOpenChange={onOpenChange} eyebrow={`${line.ref} · ${line.participations.find((p) => p.id === pid)?.supplier.legalName ?? ""}`} title={S.board.logQuote} submitLabel={S.board.logQuote} pending={pending} wide
      onSubmit={async () => {
        const fd = new FormData();
        fd.set("json", JSON.stringify({ participationId: pid, currency: f.currency, unit: f.unit, packQty: f.packQty ? Number(f.packQty) : null, incoterm: f.incoterm || null, incotermUncertain: f.uncertain, port: f.port || null, moq: f.moq ? Number(f.moq) : null, leadDays: f.lead ? Number(f.lead) : null, leadDaysMax: f.leadMax ? Number(f.leadMax) : null, validUntil: f.valid || null, paymentTerms: f.terms || null, deviations: f.deviations || null, unitWeightG: f.weight ? Number(f.weight) : null, carton: f.carton || null, notes: f.notes || null, receivedAt: f.received ? `${f.received}T09:00:00Z` : null, breaks: parsedBreaks }));
        if (file) fd.set("file", file);
        const r = await run(() => logQuoteAction(fd), { success: (d) => `Quote v${d.version} logged${d.usdMinorE2 !== null ? ` · ${formatUnitPrice({ minorE2: d.usdMinorE2, currency: "USD" }, { decimals: 4 })}/${line.unit}` : ""}` });
        return r ? undefined : false;
      }}>
      {!participation && (
        <Field label={S.board.col.supplier}><Sel value={pid} onChange={(e) => setPid(e.target.value)} data-testid="quote-participation"><option value="">—</option>{line.participations.map((p) => <option key={p.id} value={p.id}>{p.supplier.legalName}</option>)}</Sel></Field>
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={S.quote.currency}><Sel value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })} data-testid="quote-currency">{["USD", "CNY", "EUR"].map((c) => <option key={c}>{c}</option>)}</Sel></Field>
        <Field label={S.quote.unit} error={unitMismatch ? S.quote.unitMismatch : undefined}><Sel value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} data-testid="quote-unit">{UNITS.map((u) => <option key={u}>{u}</option>)}</Sel></Field>
        <Field label={S.quote.packQty}><Input value={f.packQty} onChange={(e) => setF({ ...f, packQty: e.target.value })} inputMode="numeric" className="font-mono" data-testid="quote-pack" /></Field>
        <Field label={S.quote.incoterm}><Sel value={f.incoterm} onChange={(e) => setF({ ...f, incoterm: e.target.value })} data-testid="quote-incoterm">{INCOTERMS.map((i) => <option key={i}>{i}</option>)}</Sel></Field>
        <Field label={S.quote.port}><Input value={f.port} onChange={(e) => setF({ ...f, port: e.target.value })} data-testid="quote-port" /></Field>
        <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" className="accent-green-600" checked={f.uncertain} onChange={(e) => setF({ ...f, uncertain: e.target.checked })} />{S.quote.uncertain}</label>
        <Field label={S.quote.moq}><Input value={f.moq} onChange={(e) => setF({ ...f, moq: e.target.value })} inputMode="numeric" className="font-mono" data-testid="quote-moq" /></Field>
        <Field label={S.quote.lead}><Input value={f.lead} onChange={(e) => setF({ ...f, lead: e.target.value })} inputMode="numeric" className="font-mono" data-testid="quote-lead" /></Field>
        <Field label={S.quote.leadMax}><Input value={f.leadMax} onChange={(e) => setF({ ...f, leadMax: e.target.value })} inputMode="numeric" className="font-mono" /></Field>
        <Field label={S.quote.valid}><Input type="date" value={f.valid} onChange={(e) => setF({ ...f, valid: e.target.value })} className="font-mono" data-testid="quote-valid" /></Field>
        <Field label={S.quote.received}><Input type="date" value={f.received} onChange={(e) => setF({ ...f, received: e.target.value })} className="font-mono" /></Field>
        <Field label={S.quote.weight}><Input value={f.weight} onChange={(e) => setF({ ...f, weight: e.target.value })} inputMode="decimal" className="font-mono" /></Field>
        <Field label={S.quote.terms} className="sm:col-span-2"><Input value={f.terms} onChange={(e) => setF({ ...f, terms: e.target.value })} placeholder="T/T 30/70" /></Field>
        <Field label={S.quote.carton}><Input value={f.carton} onChange={(e) => setF({ ...f, carton: e.target.value })} /></Field>
        <Field label={S.quote.deviations} className="sm:col-span-3"><Textarea rows={2} value={f.deviations} onChange={(e) => setF({ ...f, deviations: e.target.value })} placeholder="none at spec thickness" /></Field>
      </div>
      <div>
        <div className="mb-2 flex items-center justify-between"><Label>{S.quote.breaks}</Label><Button type="button" size="sm" variant="ghost" onClick={() => setBreaks((b) => [...b, { minQty: "", price: "" }])} data-testid="add-break">{S.quote.addBreak}</Button></div>
        <div className="sheet" data-testid="breaks">
          <div className="grid grid-cols-[1fr_1fr_2rem] gap-2 bg-section-alt px-3 py-1.5 text-2xs font-semibold uppercase tracking-[0.06em] text-muted-foreground"><span>{S.quote.minQty}</span><span>{S.quote.price} ({f.currency}/{f.unit})</span><span /></div>
          {breaks.map((b, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_2rem] items-center gap-2 px-3 py-1.5">
              <Input value={b.minQty} onChange={(e) => setBreaks((bs) => bs.map((x, j) => (j === i ? { ...x, minQty: e.target.value } : x)))} inputMode="numeric" className="h-8 text-right font-mono" data-testid="break-qty" />
              <Input value={b.price} onChange={(e) => setBreaks((bs) => bs.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))} inputMode="decimal" className="h-8 text-right font-mono" placeholder="0.0539" data-testid="break-price" />
              <Button type="button" size="icon-xs" variant="ghost" aria-label="Remove" onClick={() => setBreaks((bs) => bs.filter((_, j) => j !== i))}><Trash2 /></Button>
            </div>
          ))}
        </div>
        {errors.breaks && <p className="mt-1 text-xs text-danger">{errors.breaks}</p>}
        <div className="mt-2 rounded-lg bg-section-alt px-3 py-2 text-xs" data-testid="normalised-preview">
          <span className="text-muted-foreground">{S.quote.normalised} {S.board.previewLine}: </span>
          <span className="font-mono font-medium">{preview?.usdMinorE2 !== null && preview?.usdMinorE2 !== undefined ? `${formatUnitPrice({ minorE2: preview.usdMinorE2, currency: "USD" }, { decimals: 4 })} / ${line.unit}` : "—"}</span>
          {preview?.fxRate && preview.fxRate !== 1 && <span className="ml-2 text-muted-foreground">{preview.fxRate} @ {preview.fxDate}</span>}
          {preview?.flags.length ? <span className="ml-2 text-warning">{preview.flags.join(", ")}</span> : null}
        </div>
      </div>
      <Field label={S.quote.file}><Input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} data-testid="quote-file" /><p className="text-xs text-muted-foreground">{S.quote.fileHint}</p></Field>
      <Field label={S.quote.notes}><Textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      {errors._ && <p className="text-xs text-danger">{errors._}</p>}
    </FormShell>
  );
}

/* ───────── Set status (dropdown value → reason dialog when required) ───────── */
export function StatusDialog({ participation, status, open, onOpenChange }: { participation: OpsParticipation | null; status: ParticipationStatus | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useTranslations("participation_status");
  const { run, pending, errors } = useAction();
  const [reason, setReason] = React.useState("");
  const [dontBump, setDontBump] = React.useState(false);
  if (!participation || !status) return null;
  const needsReason = REASON_REQUIRED.includes(status);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="status-dialog">
        <DialogHeader>
          <DialogTitle>{participation.supplier.legalName} → {t(status)}</DialogTitle>
          <DialogDescription>{status === "selected" ? S.board.selectedHint : needsReason ? S.board.reasonRequired : "Confirm the status change."}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Field label={needsReason ? S.board.reasonRequired : `${S.timeline.reason} ${S.common.optional}`} error={errors.reason}><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus data-testid="status-reason" /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-green-600" checked={dontBump} onChange={(e) => setDontBump(e.target.checked)} />{S.board.dontBump}</label>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>{S.common.cancel}</Button>
          <Button type="button" disabled={pending} data-testid="status-confirm" onClick={async () => { const r = await run(() => setParticipationStatusAction({ participationId: participation.id, status, reason: reason || null, dontBump }), { success: `${participation.supplier.legalName} → ${t(status)}` }); if (r) onOpenChange(false); }}>{S.common.confirm}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ───────── Notes ───────── */
export function NotesSheet({ participation, open, onOpenChange }: { participation: OpsParticipation | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { run, pending } = useAction();
  const [notes, setNotes] = React.useState(participation?.notes ?? "");
  const [last, setLast] = React.useState(participation?.lastContactAt?.slice(0, 10) ?? "");
  const [dontBump, setDontBump] = React.useState(false);
  if (!participation) return null;
  return (
    <FormShell open={open} onOpenChange={onOpenChange} eyebrow={participation.supplier.ref} title={`${S.board.editNote} · ${participation.supplier.legalName}`} submitLabel={S.common.save} pending={pending}
      onSubmit={async () => { const r = await run(() => updateParticipationAction({ participationId: participation.id, notes: notes || null, lastContactAt: last && last !== participation.lastContactAt?.slice(0, 10) ? `${last}T09:00:00Z` : null, dontBump }), { success: "Note saved" }); return r ? undefined : false; }}>
      <Field label={S.board.col.notes}><Textarea rows={5} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="MOQ, breaks, payment, certs, “cannot make”…" data-testid="notes-text" /></Field>
      <Field label="Last contact"><Input type="date" value={last} onChange={(e) => setLast(e.target.value)} className="font-mono" /></Field>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-green-600" checked={dontBump} onChange={(e) => setDontBump(e.target.checked)} />{S.board.dontBump}</label>
      <div className="text-xs text-muted-foreground">Status: <ParticipationChip status={participation.status} /> {participation.reason && <span>· {participation.reason}</span>}</div>
    </FormShell>
  );
}

/* ───────── Mark RFQ sent ───────── */
export function RfqDialog({ line, open, onOpenChange }: { line: OpsLine; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { run, pending, errors } = useAction();
  const [count, setCount] = React.useState(String(line.participations.length));
  const [file, setFile] = React.useState<File | null>(null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="rfq-dialog">
        <DialogHeader><DialogTitle>{S.board.markRfq}</DialogTitle><DialogDescription>{S.board.rfqHint}</DialogDescription></DialogHeader>
        <div className="flex flex-col gap-3">
          <Field label={S.board.rfqRecipients} error={errors.recipientsCount ?? errors._}><Input value={count} onChange={(e) => setCount(e.target.value)} inputMode="numeric" className="w-32 font-mono" data-testid="rfq-count" /></Field>
          <Field label={S.board.rfqFile}><Input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>
          {!line.targetConfirmed && line.state === "cost_target_price" && <p className="text-xs text-warning">Target price not confirmed — confirm it on the Cost tab first.</p>}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>{S.common.cancel}</Button>
          <Button type="button" disabled={pending} data-testid="rfq-confirm" onClick={async () => { const fd = new FormData(); fd.set("lineId", line.id); fd.set("recipientsCount", count); if (file) fd.set("file", file); const r = await run(() => markRfqSentAction(fd), { success: (d) => `RFQ sent to ${d.recipients}` }); if (r) onOpenChange(false); }}>{S.common.confirm}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ───────── Shortlist selected ───────── */
export function ShortlistDialog({ line, ids, open, onOpenChange, onDone }: { line: OpsLine; ids: string[]; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const { run, pending, errors } = useAction();
  const [reason, setReason] = React.useState("");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{S.board.shortlist} · {ids.length}</DialogTitle><DialogDescription>{line.participations.filter((p) => ids.includes(p.id)).map((p) => p.supplier.legalName).join(", ")}</DialogDescription></DialogHeader>
        <Field label={S.board.reasonRequired} error={errors.reason}><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></Field>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>{S.common.cancel}</Button>
          <Button type="button" disabled={pending || !reason.trim()} onClick={async () => { const r = await run(() => shortlistAction({ lineRef: line.ref, participationIds: ids, reason }), { success: `Shortlisted ${ids.length}` }); if (r) { onOpenChange(false); onDone(); } }}>{S.board.shortlist}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export const STATUS_OPTIONS = PARTICIPATION_STATUSES;
export { e2ToText };
