"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Check, ImageIcon, ArrowRight } from "lucide-react";
import type { ClientSampleDto } from "@/server/client/dto";
import type { ActionResult } from "@/server/shared/http";
import { formatMoney } from "@/server/shared/money";
import { fmtDateShort } from "@/lib/format-date";
import { PageHeader } from "@/components/shared/page-header";
import { PageBand } from "@/components/shared/section-band";
import { FactsStrip } from "@/components/shared/facts-strip";
import { Eyebrow } from "@/components/shared/eyebrow";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { trackingUrl } from "../client-format";
import { C } from "./strings";

const STATUS: Record<ClientSampleDto["status"], string> = { ordered: "Being made", shipped: "On its way to you", received: "Arrived — your approval", approved: "Approved", rejected: "Rejected" };
const CHECKS = ["Size and material match what we confirmed", "Colour, print and finish look right", "Packaging and labels are as agreed", "Nothing is damaged or missing"];

/** SPEC F-09 — dated steps, what to check, photos, cost; Approve / Reject (reason ≥ 10 chars, ≤ 5 photos). */
export function ClientSamplePage({ sample: s, approve, reject }: { sample: ClientSampleDto; approve: (i: { ref: string; note?: string | null }) => Promise<ActionResult<{ lineRef: string }>>; reject: (fd: FormData) => Promise<ActionResult<{ lineRef: string; photos: number }>> }) {
  const router = useRouter();
  const [dialog, setDialog] = React.useState<"approve" | "reject" | null>(null);
  const [reason, setReason] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, start] = React.useTransition();
  const fileRef = React.useRef<HTMLInputElement>(null);
  const track = trackingUrl(s.courier, s.tracking);
  const steps = [
    { key: "ordered", label: C.sample.ordered, at: s.orderedAt },
    { key: "shipped", label: C.sample.shipped, at: s.shippedAt },
    { key: "received", label: C.sample.received, at: s.receivedAt },
    { key: "decided", label: s.status === "rejected" ? "Rejected" : "Approved", at: s.decidedAt },
  ];
  const finish = (r: ActionResult<{ lineRef: string }>, msg: string) => {
    if (r.ok) { toast.success(msg); setDialog(null); router.push(`/app/lines/${r.data.lineRef}`); router.refresh(); }
    else { const m = r.message ?? (r.errors ? Object.values(r.errors)[0] : null) ?? "Couldn't send — please try again."; setError(m); toast.error(m); }
  };
  return (
    <div className={cn(s.canDecide && "max-lg:pb-32")} data-testid="client-sample" data-status={s.status}>
      <PageHeader
        band
        crumbs={[{ href: "/app/requests", label: "Requests" }, { href: `/app/lines/${s.lineRef}`, label: <span className="font-mono">{s.lineRef}</span> }, { label: "Sample" }]}
        title={C.sample.title(s.lineName)}
        meta={<>
          <span className={cn("inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium", s.status === "approved" ? "border-success-border bg-success-wash text-success" : s.status === "rejected" ? "border-danger-border bg-danger-wash text-danger" : s.canDecide ? "border-green-200 bg-green-100 text-green-700" : "border-neutral-border bg-neutral-wash text-ink-2")} data-testid="sample-status">{STATUS[s.status]}{s.decidedAt && (s.status === "approved" || s.status === "rejected") ? ` · ${fmtDateShort(s.decidedAt)}` : ""}</span>
          {s.status === "rejected" && s.rejectReason && <span className="text-sm text-ink-2 [overflow-wrap:anywhere]" data-testid="verdict">“{s.rejectReason}”</span>}
        </>}
        tabs={
          <ol className="grid grid-cols-2 gap-3 pt-2 pb-1 sm:grid-cols-4" data-testid="sample-steps">
            {steps.map((st) => (
              <li key={st.key} className="flex items-center gap-2" data-step={st.key} data-done={!!st.at || undefined}>
                <span className={cn("flex size-5 shrink-0 items-center justify-center rounded-full", st.at ? "bg-foreground text-white" : "border border-hairline-strong bg-card")}>{st.at && <Check className="size-3" strokeWidth={3} />}</span>
                <span className="min-w-0 text-sm"><span className={st.at ? "font-medium text-foreground" : "text-muted-foreground"}>{st.label}</span> <span className="font-mono text-xs text-muted-foreground">{st.at ? fmtDateShort(st.at) : ""}</span></span>
              </li>
            ))}
          </ol>
        }
        className="pb-5"
      />

      <PageBand tone="page" pad="md">
        <FactsStrip columns={2} facts={[
          { label: C.sample.cost, value: <span data-testid="sample-cost">{s.cost ? formatMoney(s.cost) : s.paidBy && s.paidBy !== "client" ? "No charge" : "To be confirmed"}</span>, sub: s.paidBy ? C.sample.paidBy(s.paidBy) : undefined },
          { label: C.sample.tracking, value: <span className="block text-base break-all sm:text-xl" data-testid="sample-tracking">{s.tracking ? (track ? <a href={track} target="_blank" rel="noreferrer noopener" className="hover:underline">{s.tracking}</a> : s.tracking) : "Not shipped yet"}</span>, sub: s.courier ? <>{s.courier}{track && <> · <a href={track} target="_blank" rel="noreferrer noopener" className="link">track it ↗</a></>}</> : undefined },
        ]} />
      </PageBand>

      <PageBand tone="page" pad="none" className="pb-8">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <section className="rounded-xl border border-border bg-card p-5" aria-labelledby="photos-h">
            <div className="mb-3 flex items-center justify-between"><h2 id="photos-h" className="text-base font-semibold">{C.sample.photos}</h2><span className="font-mono text-xs text-muted-foreground">{s.photos.length}</span></div>
            {s.photos.length === 0 ? (
              <div className="flex items-center gap-3 rounded-lg bg-section-alt p-4 text-sm text-ink-2"><ImageIcon className="size-5 shrink-0 text-muted-foreground" strokeWidth={1.75} />We&apos;ll add photos when the sample is checked in our office. You can also judge it in hand.</div>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3" data-testid="sample-photos">
                {s.photos.map((p) => (
                  <a key={p.id} href={p.downloadUrl} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border border-border bg-section-alt">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.downloadUrl} alt={p.filename} className="aspect-[4/3] w-full object-cover" />
                  </a>
                ))}
              </div>
            )}
          </section>
          <aside className="flex flex-col gap-4 lg:sticky lg:top-20 lg:self-start">
            <section className="rounded-xl border border-hairline-strong bg-section-alt p-5" aria-labelledby="check-h">
              <h2 id="check-h" className="text-sm font-semibold">Check against what we confirmed</h2>
              <ul className="mt-3 flex flex-col gap-2 text-sm text-ink-2">{CHECKS.map((c) => <li key={c} className="flex gap-2"><Check className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />{c}</li>)}</ul>
              <Link href={`/app/lines/${s.lineRef}`} className="link mt-3 inline-flex items-center gap-1 text-xs">See the confirmed spec<ArrowRight className="size-3" /></Link>
            </section>
            <section className="rounded-xl border border-border bg-card p-5" aria-labelledby="after-h">
              <h2 id="after-h" className="text-sm font-semibold">After you approve</h2>
              <ol className="mt-3 flex flex-col gap-3">
                <li><Eyebrow variant="pill" number={1}>Order confirmation</Eyebrow><p className="mt-1 text-xs text-ink-2">We confirm the order at the accepted price and send the deposit invoice.</p></li>
                <li><Eyebrow variant="pill" number={2}>Production</Eyebrow><p className="mt-1 text-xs text-ink-2">Mass production matches this sample. You follow it on the order page.</p></li>
              </ol>
            </section>
            {!s.canDecide && s.status !== "approved" && s.status !== "rejected" && <p className="text-sm text-muted-foreground">{C.sample.waiting}</p>}
            {s.canDecide && (
              <div className="max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:z-30 max-lg:border-t max-lg:border-border max-lg:bg-card/95 max-lg:px-4 max-lg:pt-3 max-lg:pb-[max(0.75rem,env(safe-area-inset-bottom))] max-lg:backdrop-blur-sm lg:rounded-xl lg:border lg:border-border lg:bg-card lg:p-5" data-testid="decision-bar">
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="action" size="lg" className="col-span-2" onClick={() => { setError(null); setDialog("approve"); }} data-testid="approve">{C.sample.approve} sample</Button>
                  <Button variant="ghost" size="lg" className="col-span-2 text-danger hover:text-danger" onClick={() => { setError(null); setDialog("reject"); }} data-testid="reject">Something is wrong — reject</Button>
                </div>
              </div>
            )}
          </aside>
        </div>
      </PageBand>

      <Dialog open={dialog === "approve"} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{C.sample.approveTitle}</DialogTitle><DialogDescription>{C.sample.approveBody}</DialogDescription></DialogHeader>
          {error && <p className="text-xs text-danger" role="alert">{error}</p>}
          <DialogFooter><Button variant="ghost" onClick={() => setDialog(null)}>{C.offer.cancel}</Button><Button variant="action" disabled={pending} data-testid="approve-confirm" onClick={() => start(async () => finish(await approve({ ref: s.ref }), "Sample approved"))}>{pending && <Loader2 className="animate-spin" />}{C.sample.approve}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={dialog === "reject"} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{C.sample.rejectTitle}</DialogTitle><DialogDescription>{C.sample.rejectHint}</DialogDescription></DialogHeader>
          <label className="flex flex-col gap-1.5 text-sm"><span className="text-xs text-ink-2">{C.sample.rejectReason}</span><Textarea rows={3} value={reason} onChange={(e) => { setReason(e.target.value); setError(null); }} className="text-base" aria-invalid={!!error} data-testid="reject-reason" /></label>
          <label className="flex flex-col gap-1.5 text-sm"><span className="text-xs text-ink-2">{C.sample.rejectPhotos}</span><input ref={fileRef} type="file" accept="image/*" multiple className="text-sm" data-testid="reject-photos" /></label>
          {error && <p className="text-xs text-danger" role="alert">{error}</p>}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialog(null)}>{C.offer.cancel}</Button>
            <Button variant="destructive" disabled={pending} data-testid="reject-confirm" onClick={() => { if (reason.trim().length < 10) { setError("Tell us what is wrong (at least 10 characters)."); return; } start(async () => { const fd = new FormData(); fd.set("ref", s.ref); fd.set("reason", reason); for (const f of fileRef.current?.files ?? []) fd.append("photos", f); finish(await reject(fd), "Sample rejected — we'll sort it out"); }); }}>{pending && <Loader2 className="animate-spin" />}{C.sample.reject}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

