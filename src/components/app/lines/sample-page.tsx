"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, ArrowLeft, Check, Package, Truck, Inbox } from "lucide-react";
import type { ClientSampleDto } from "@/server/client/dto";
import type { ActionResult } from "@/server/shared/http";
import { formatMoney } from "@/server/shared/money";
import { formatDate } from "@/server/shared/dates";
import { PageHeader } from "@/components/shared/page-header";
import { SampleStatusChip } from "@/components/shared/chips";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { C } from "./strings";

/** SPEC F-09 — status timeline, photos, cost, Approve / Reject (reason ≥ 10 chars, ≤ 5 photos). */
export function ClientSamplePage({ sample: s, approve, reject }: { sample: ClientSampleDto; approve: (i: { ref: string; note?: string | null }) => Promise<ActionResult<{ lineRef: string }>>; reject: (fd: FormData) => Promise<ActionResult<{ lineRef: string; photos: number }>> }) {
  const router = useRouter();
  const [dialog, setDialog] = React.useState<"approve" | "reject" | null>(null);
  const [reason, setReason] = React.useState("");
  const [pending, start] = React.useTransition();
  const fileRef = React.useRef<HTMLInputElement>(null);
  const steps = [
    { key: "ordered", label: C.sample.ordered, at: s.orderedAt, icon: Package, done: !!s.orderedAt },
    { key: "shipped", label: C.sample.shipped, at: s.shippedAt, icon: Truck, done: !!s.shippedAt, detail: s.courier ? <>{s.courier} · <span className="font-mono">{s.tracking}</span></> : null },
    { key: "received", label: C.sample.received, at: s.receivedAt, icon: Inbox, done: !!s.receivedAt },
  ];
  const finish = (r: ActionResult<{ lineRef: string }>, msg: string) => { if (r.ok) { toast.success(msg); setDialog(null); router.push(`/app/lines/${r.data.lineRef}`); router.refresh(); } else toast.error(r.error === "E_VALIDATION" ? C.sample.rejectHint : r.error); };
  return (
    <div className="flex flex-col gap-6 pb-24" data-testid="client-sample" data-status={s.status}>
      <PageHeader
        eyebrow={<span className="font-mono">{C.sample.eyebrow(s.ref).toUpperCase()} · {s.lineRef}</span>}
        title={C.sample.title(s.lineName)}
        meta={<><SampleStatusChip status={s.status} />{s.status === "approved" && <span className="text-sm text-success" data-testid="verdict">{C.sample.approved(formatDate(s.decidedAt))}</span>}{s.status === "rejected" && <span className="text-sm text-danger" data-testid="verdict">{C.sample.rejected(formatDate(s.decidedAt))}{s.rejectReason ? ` — “${s.rejectReason}”` : ""}</span>}</>}
        actions={<Button asChild variant="ghost"><Link href={`/app/lines/${s.lineRef}`}><ArrowLeft data-icon="inline-start" />{C.sample.backToLine}</Link></Button>}
      />
      <ol className="rounded-xl border border-border bg-card p-5 md:grid md:grid-cols-3 md:gap-4" data-testid="sample-steps">
        {steps.map((st) => (
          <li key={st.key} className={cn("flex gap-3 py-3 md:flex-col md:py-0", st.done ? "text-foreground" : "text-muted-foreground")} data-step={st.key} data-done={st.done || undefined}>
            <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-full", st.done ? "bg-foreground text-white" : "border border-hairline-strong bg-card")}>{st.done ? <Check className="size-4" /> : <st.icon className="size-4" />}</span>
            <div>
              <div className="text-sm font-medium">{st.label}{st.at && <span className="ml-2 font-mono text-xs text-muted-foreground">{formatDate(st.at)}</span>}</div>
              {st.detail && <div className="text-xs text-ink-2">{st.detail}</div>}
            </div>
          </li>
        ))}
      </ol>
      <dl className="grid grid-cols-2 divide-x divide-hairline-faint overflow-hidden rounded-xl border border-border bg-card">
        <div className="px-5 py-4"><dt className="eyebrow">{C.sample.cost}</dt><dd className="mt-1 font-mono text-lg font-medium" data-testid="sample-cost">{s.cost ? formatMoney(s.cost) : "—"}</dd>{s.paidBy && <dd className="text-xs text-muted-foreground">{C.sample.paidBy(s.paidBy)}</dd>}</div>
        <div className="px-5 py-4"><dt className="eyebrow">{C.sample.tracking}</dt><dd className="mt-1 font-mono text-lg font-medium" data-testid="sample-tracking">{s.tracking ?? "—"}</dd>{s.courier && <dd className="text-xs text-muted-foreground">{s.courier}</dd>}</div>
      </dl>
      <section className="rounded-xl border border-border bg-card p-5">
        <div className="mb-3 flex items-center justify-between"><h2 className="text-base font-semibold">{C.sample.photos}</h2><span className="font-mono text-xs text-muted-foreground">{s.photos.length}</span></div>
        {s.photos.length === 0 ? <p className="text-sm text-muted-foreground">{C.sample.noPhotos}</p> : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4" data-testid="sample-photos">
            {s.photos.map((p) => (
              <a key={p.id} href={p.downloadUrl} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border border-border bg-section-alt">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.downloadUrl} alt={p.filename} className="aspect-[4/3] w-full object-cover" />
              </a>
            ))}
          </div>
        )}
      </section>
      {!s.canDecide && s.status !== "approved" && s.status !== "rejected" && <p className="text-sm text-muted-foreground">{C.sample.waiting}</p>}
      {s.canDecide && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card/95 p-4 backdrop-blur-sm" data-testid="decision-bar">
          <div className="mx-auto flex max-w-[72rem] justify-end gap-2 max-sm:[&>*]:flex-1">
            <Button variant="outline" size="lg" className="text-danger" onClick={() => setDialog("reject")} data-testid="reject">{C.sample.reject}</Button>
            <Button variant="action" size="lg" onClick={() => setDialog("approve")} data-testid="approve">{C.sample.approve}</Button>
          </div>
        </div>
      )}
      <Dialog open={dialog === "approve"} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{C.sample.approveTitle}</DialogTitle><DialogDescription>{C.sample.approveBody}</DialogDescription></DialogHeader>
          <DialogFooter><Button variant="ghost" onClick={() => setDialog(null)}>{C.offer.cancel}</Button><Button variant="action" disabled={pending} data-testid="approve-confirm" onClick={() => start(async () => finish(await approve({ ref: s.ref }), "Sample approved"))}>{pending && <Loader2 className="animate-spin" />}{C.sample.approve}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={dialog === "reject"} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{C.sample.rejectTitle}</DialogTitle><DialogDescription>{C.sample.rejectHint}</DialogDescription></DialogHeader>
          <label className="flex flex-col gap-1.5 text-sm"><span className="text-xs text-ink-2">{C.sample.rejectReason}</span><Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} className="text-base" data-testid="reject-reason" /></label>
          <label className="flex flex-col gap-1.5 text-sm"><span className="text-xs text-ink-2">{C.sample.rejectPhotos}</span><input ref={fileRef} type="file" accept="image/*" multiple className="text-sm" data-testid="reject-photos" /></label>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialog(null)}>{C.offer.cancel}</Button>
            <Button variant="destructive" disabled={pending || reason.trim().length < 10} data-testid="reject-confirm" onClick={() => start(async () => { const fd = new FormData(); fd.set("ref", s.ref); fd.set("reason", reason); for (const f of fileRef.current?.files ?? []) fd.append("photos", f); finish(await reject(fd), "Sample rejected"); })}>{C.sample.reject}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
