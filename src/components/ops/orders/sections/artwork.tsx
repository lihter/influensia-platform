"use client";
import * as React from "react";
import { Check, FileText } from "lucide-react";
import type { OpsOrderDetail, OpsArtwork } from "@/server/ops/orders";
import { FormShell } from "@/components/shared/form-shell";
import { VisibilityBadge } from "@/components/shared/chips";
import { DateTime, Ref } from "@/components/shared/formatters";
import { formatBytes } from "@/components/shared/document-row";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { decideArtworkAction, setArtworkRequiredAction, uploadDielineAction } from "@/app/(ops)/ops/orders/actions";
import { OrderSection, useAct, TextareaField, FileField, fd, str } from "../ui";
import { ARTWORK_STATUS } from "../strings";

const tone = (s: string) => (s === "approved" ? "success" : s === "changes_requested" ? "warning" : "outline");

/** 03 Artwork — per line: dieline, submitted file, status chip, Approve (green sm) / Request changes (outline sm), dieline upload, artwork_required toggle. */
export function ArtworkSection({ d }: { d: OpsOrderDetail }) {
  const open = d.artworks.filter((a) => a.artworkRequired && a.current?.status === "submitted").length;
  const none = d.artworks.every((a) => !a.artworkRequired);
  return (
    <OrderSection id="artwork" number={3} title="Artwork" count={open}>
      {none && <p className="mb-3 text-sm text-muted-foreground">No artwork needed for this order.</p>}
      <ul className="sheet bg-card">
        {d.artworks.map((a) => <ArtworkRow key={a.orderLineId} a={a} orderRef={d.order.ref} />)}
      </ul>
    </OrderSection>
  );
}

function ArtworkRow({ a, orderRef }: { a: OpsArtwork; orderRef: string }) {
  const { act, pending } = useAct();
  const cur = a.current;
  return (
    <li className="sheet-row flex flex-col gap-3" data-testid="artwork-row" data-status={cur?.status ?? "none"}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2"><Ref muted>{a.lineRef}</Ref>{!a.artworkRequired && <Badge variant="neutral">Not required</Badge>}</div>
          <p className="truncate text-sm font-medium text-foreground">{a.lineName}</p>
        </div>
        <div className="flex items-center gap-2">
          {cur && <Badge variant={tone(cur.status)}>{ARTWORK_STATUS[cur.status]}{cur.status !== "submitted" && cur.decidedAt && <span className="font-mono normal-case tracking-normal"> · <DateTime value={cur.decidedAt} variant="short" /></span>}</Badge>}
          {a.artworkRequired && !cur && <Badge variant="outline">Waiting for upload</Badge>}
        </div>
      </div>
      <div className="grid gap-3 text-sm md:grid-cols-2">
        {/* file tile: icon | name (truncates) | badge | action — each in its own column, nothing overlaps (UX §ops order) */}
        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-3 rounded-lg border border-hairline-faint bg-section-alt px-3 py-2">
          <FileText className="size-4 text-muted-foreground" />
          <div className="min-w-0">
            <div className="text-2xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Dieline</div>
            {a.dieline ? <a href={a.dieline.downloadUrl} className="link block truncate text-sm" title={a.dieline.filename} download>{a.dieline.filename}</a> : <span className="text-sm text-muted-foreground">None uploaded</span>}
          </div>
          {a.dieline ? <VisibilityBadge visibility={a.dieline.visibility} /> : <span />}
          <DielineSheet orderLineId={a.orderLineId} orderRef={orderRef} />
        </div>
        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-lg border border-hairline-faint bg-section-alt px-3 py-2">
          <FileText className="size-4 text-muted-foreground" />
          <div className="min-w-0">
            <div className="text-2xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Client artwork {cur ? `v${cur.version}` : ""}</div>
            {cur?.file ? <a href={cur.file.downloadUrl} className="link flex min-w-0 items-baseline gap-1 text-sm" title={cur.file.filename} download><span className="truncate">{cur.file.filename}</span><span className="shrink-0 font-mono text-xs text-muted-foreground">{formatBytes(cur.file.bytes)}</span></a> : <span className="text-sm text-muted-foreground">Not uploaded yet</span>}
            {cur?.clientNote && <p className="mt-0.5 text-xs text-ink-2">“{cur.clientNote}”</p>}
          </div>
        </div>
      </div>
      {cur?.status === "changes_requested" && cur.internalNote && <p className="text-xs text-warning">Requested: {cur.internalNote}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {cur && cur.status !== "approved" && (
          <Button size="sm" variant="green" data-testid="approve-artwork" disabled={pending} onClick={() => act(() => decideArtworkAction({ artworkId: cur.id, decision: "approved" }), { success: "Artwork approved" })}><Check />Approve</Button>
        )}
        {cur && cur.status === "submitted" && <RequestChangesSheet artworkId={cur.id} orderRef={orderRef} />}
        <Button size="sm" variant="ghost" className="ml-auto text-muted-foreground" disabled={pending} onClick={() => act(() => setArtworkRequiredAction({ orderLineId: a.orderLineId, required: !a.artworkRequired }), { success: a.artworkRequired ? "Artwork no longer required" : "Artwork required" })}>
          {a.artworkRequired ? "Mark not required" : "Mark required"}
        </Button>
      </div>
      {a.versions.length > 1 && (
        <p className="text-xs text-muted-foreground">Versions: {a.versions.map((v) => `v${v.version} ${ARTWORK_STATUS[v.status].toLowerCase()}`).join(" · ")}</p>
      )}
    </li>
  );
}

function RequestChangesSheet({ artworkId, orderRef }: { artworkId: string; orderRef: string }) {
  const { act } = useAct();
  return (
    <FormShell trigger={<Button size="sm" variant="outline" data-testid="request-changes">Request changes</Button>} eyebrow={orderRef} title="Request artwork changes" submitLabel="Send to client"
      onSubmit={async (e) => { const f = fd(e); return act(() => decideArtworkAction({ artworkId, decision: "changes_requested", note: str(f, "note") }), { success: "Changes requested" }); }}>
      <TextareaField name="note" label="What should change? (client-visible, leak-checked)" required rows={4} />
    </FormShell>
  );
}

function DielineSheet({ orderLineId, orderRef }: { orderLineId: string; orderRef: string }) {
  const { act } = useAct();
  return (
    <FormShell trigger={<Button size="sm" variant="ghost">Upload dieline</Button>} eyebrow={orderRef} title="Upload dieline" description="Published to the client after the leak check (filename + text)." submitLabel="Upload & publish"
      onSubmit={async (e) => { const f = fd(e); f.set("orderLineId", orderLineId); return act(() => uploadDielineAction(f), { success: "Dieline published" }); }}>
      <FileField label="Dieline (PDF/AI)" accept=".pdf,.ai,.png,.jpg" required />
    </FormShell>
  );
}
