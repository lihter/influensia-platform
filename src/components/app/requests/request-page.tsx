"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowRight, Check, Loader2, Trash2, Send, AlertCircle, MessageCircle } from "lucide-react";
import type { ClientRequestPageDto } from "@/server/client/dto/requests";
import type { ActionResult } from "@/server/shared/http";
import { fmtDate } from "@/lib/format-date";
import { unitLabel } from "@/lib/labels";
import { PageHeader } from "@/components/shared/page-header";
import { PageBand } from "@/components/shared/section-band";
import { MilestoneChip, ExceptionChip, UtilityBadge } from "@/components/shared/chips";
import { Timeline, type TimelineEntry } from "@/components/shared/timeline";
import { DocumentRow } from "@/components/shared/document-row";
import { Eyebrow } from "@/components/shared/eyebrow";
import { Qty, Ref } from "@/components/shared/formatters";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { AskComposer } from "../ask-composer";
import { NextShort } from "../now-next";
import { chipLabel, nextStepFor, platformOf, shortLink } from "../client-format";
import { S } from "./strings";

const T = S.request;
type Act = (input: { requestId: string }) => Promise<ActionResult<{ ref: string }>>;

/**
 * F-06 — request page: white header band (crumbs, status, source), optional confirmation card, the lines sheet with
 * one status chip + "what's next" per line, then Updates (with the Ask composer, QA-08) / Documents / History.
 * Drafts get "Send request" and "Delete draft".
 */
export function RequestPage({ dto, justSent, submitDraft, deleteDraft }: { dto: ClientRequestPageDto; justSent: boolean; submitDraft: Act; deleteDraft: Act }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const req = dto.request;
  const isDraft = req.status === "draft";
  const toasted = React.useRef(false);
  React.useEffect(() => {
    if (justSent && !toasted.current) { toasted.current = true; toast.success(T.sentToast(req.ref)); }
  }, [justSent, req.ref]);

  const send = () => start(async () => {
    const r = await submitDraft({ requestId: req.id });
    if (r.ok) { toast.success(T.sentToast(r.data.ref)); router.replace(`/app/requests/${r.data.ref}?sent=1`); router.refresh(); }
    else toast.error(r.message ?? (r.errors ? Object.values(r.errors)[0] : null) ?? "Couldn't send — please try again.");
  });
  const del = () => start(async () => {
    const r = await deleteDraft({ requestId: req.id });
    if (r.ok) { toast.success("Draft deleted"); router.push("/app/requests?tab=drafts"); router.refresh(); }
    else toast.error(r.message ?? "Couldn't delete — please try again.");
  });

  const updates: TimelineEntry[] = dto.updates.map((u) => ({
    id: u.id, kind: u.kind === "comment" ? "note" : u.isActionMilestone ? "action_milestone" : "milestone", at: u.at,
    title: u.kind === "comment" ? undefined : u.text, body: u.kind === "comment" ? u.text : undefined,
    author: u.kind === "comment" ? (u.byYou ? "You" : u.authorName ?? "Influensia") : u.authorName ?? undefined,
  }));
  const history: TimelineEntry[] = dto.history.map((e) => ({ id: e.id, kind: e.isActionMilestone ? "action_milestone" : e.isMilestone ? "milestone" : "system", at: e.at, title: e.text, author: e.actorName ?? undefined }));
  const agentName = req.lines.find((l) => l.agentName)?.agentName ?? null;
  const waitingCount = req.lines.filter((l) => l.waitingReason).length;

  return (
    <div data-testid="client-request" data-ref={req.ref}>
      <PageHeader
        band
        crumbs={[{ href: isDraft ? "/app/requests?tab=drafts" : "/app/requests", label: "Requests" }, { label: <span className="font-mono">{req.ref}</span> }]}
        title={<span className="font-mono">{req.ref}</span>}
        meta={
          <>
            {isDraft ? <UtilityBadge kind="draft">{T.status.draft}</UtilityBadge> : <span className="inline-flex h-6 items-center rounded-full border border-neutral-border bg-neutral-wash px-2.5 text-xs font-medium text-ink-2">{T.status[req.status]}</span>}
            <span className="text-xs text-muted-foreground">{req.lines.length} {req.lines.length === 1 ? "line" : "lines"} · {req.submittedAt ? `${T.sent} ${fmtDate(req.submittedAt)}` : `${T.created} ${fmtDate(req.createdAt)}`}{req.source === "agent_on_behalf" ? " · entered for you by your contact" : req.source === "import" ? " · from your file" : ""}</span>
            {agentName && <span className="text-xs text-muted-foreground">Your contact: {agentName}</span>}
          </>
        }
        actions={isDraft ? (
          <>
            <Button variant="outline" size="lg" disabled={pending} onClick={() => setConfirmDelete(true)} data-testid="delete-draft"><Trash2 />{T.deleteDraft}</Button>
            <Button size="lg" disabled={pending} onClick={send} data-testid="send-draft">{pending ? <Loader2 className="animate-spin" /> : <Send />}{T.sendDraft}</Button>
          </>
        ) : <Button asChild variant="outline" size="lg"><a href="#ask"><MessageCircle data-icon="inline-start" />Ask about this request</a></Button>}
      />

      {(confirmDelete || justSent || isDraft) && (
        <PageBand tone="white" pad="sm" className="flex flex-col gap-3">
          {confirmDelete && (
            <div className="flex flex-col gap-3 rounded-xl border border-danger-border bg-danger-wash p-4 sm:flex-row sm:items-center sm:justify-between" role="alertdialog" aria-label={T.deleteDraft}>
              <p className="flex items-center gap-2 text-sm text-foreground"><AlertCircle className="size-4 text-danger" />{T.deleteConfirm}</p>
              <div className="flex gap-2"><Button variant="ghost" onClick={() => setConfirmDelete(false)}>Cancel</Button><Button variant="destructive" onClick={del} disabled={pending} data-testid="confirm-delete">{T.deleteDraft}</Button></div>
            </div>
          )}
          {justSent && (
            <section className="rounded-xl border border-green-200 bg-green-50 p-5" data-testid="sent-confirmation">
              <div className="flex items-start gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-green-100"><Check className="size-5 text-green-700" /></span>
                <div className="min-w-0 flex-1">
                  <Eyebrow className="mb-1">{T.confirmTitle} · <span className="font-mono">{req.ref}</span></Eyebrow>
                  <p className="text-base font-medium text-foreground">We&apos;ll confirm the spec and send your price — usually within 5 working days.</p>
                  <p className="mt-1 text-sm text-ink-2">You get an email at each step. Questions? Use the message box below.</p>
                </div>
                <Button asChild variant="outline" className="hidden sm:inline-flex"><Link href="/app/requests/new">{S.newRequest.another}</Link></Button>
              </div>
            </section>
          )}
          {isDraft && !confirmDelete && <p className="text-sm text-ink-2">{T.draftHint}</p>}
        </PageBand>
      )}

      <PageBand tone="page" pad="lg" aria-labelledby="lines-h">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 id="lines-h" className="text-lg font-semibold">{T.linesTitle} <span className="font-mono text-sm font-normal text-muted-foreground">{req.lines.length}</span></h2>
          {waitingCount > 0 && <span className="text-sm font-medium text-green-700">{waitingCount} waiting on you</span>}
        </div>
        <ul className="sheet" data-testid="request-lines">
          {req.lines.map((l) => {
            const href = l.orderRef ? `/app/orders/${l.orderRef}` : isDraft ? null : `/app/lines/${l.ref}`;
            const step = nextStepFor({ milestone: l.milestone, state: l.state, waitingReason: l.waitingReason, exception: l.exception, offerOutcome: l.offerOutcome, sourcing: l.sourcingProgress, since: l.lastChangeAt, agentName: l.agentName, isRepeat: l.isRepeat, etaDate: l.etaDate, etaLabel: l.etaLabel, onHoldReason: l.onHoldReason });
            return (
              <li key={l.id} className={`sheet-row relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 md:grid-cols-[minmax(0,1fr)_auto_10.5rem_1rem] ${href ? "transition-colors duration-[120ms] hover:bg-surface-sunken" : ""}`} data-testid="request-line" data-ref={l.ref}>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Ref muted>{l.orderRef ? `${l.orderRef} · line ${String(l.lineNo).padStart(2, "0")}` : l.ref}</Ref>
                    {l.isRepeat && <UtilityBadge kind="repeat">Repeat</UtilityBadge>}
                  </div>
                  <div className="truncate text-sm font-medium text-foreground" title={l.name}>{href ? <Link href={href} className="after:absolute after:inset-0 after:content-['']">{l.name}</Link> : l.name}</div>
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 text-xs text-ink-2">
                    {l.qty !== null && <><Qty qty={l.qty} unit={unitLabel(l.unit, l.qty)} /><span>·</span></>}
                    <span data-testid="sub-label">{l.exceptionText ?? l.subLabel}</span>
                  </div>
                  {l.links.length > 0 && (
                    <div className="mt-1 flex min-w-0 flex-col gap-0.5">
                      {l.links.map((u) => (
                        <a key={u} href={u} target="_blank" rel="noreferrer noopener" title={u} className="relative z-10 flex min-w-0 max-w-full items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground" data-testid="line-link">
                          <span className="shrink-0 rounded-sm bg-section-alt px-1 text-2xs font-semibold text-ink-2">{platformOf(u).label}</span>
                          <span className="min-w-0 truncate font-mono">{shortLink(u)}</span>
                        </a>
                      ))}
                    </div>
                  )}
                  {l.note && <p className="mt-1 text-xs text-muted-foreground [overflow-wrap:anywhere]">“{l.note}”</p>}
                </div>
                <div className="flex flex-col items-end gap-1">
                  {l.exception ? <ExceptionChip exception={l.exception} client /> : <MilestoneChip milestone={l.milestone} waitingOnClient={!!l.waitingReason} label={chipLabel(l)} />}
                </div>
                {!isDraft && (step.short ? <div className="col-span-2 md:col-span-1 md:text-right"><NextShort step={step} className="font-mono" /></div> : <div className="hidden md:block" />)}
                {href ? <ArrowRight className="hidden size-4 text-faint md:block" aria-hidden /> : <span className="hidden md:block" />}
              </li>
            );
          })}
        </ul>
        {req.note && (
          <div className="mt-6 rounded-xl border border-border bg-card p-5">
            <Eyebrow className="mb-1.5">{T.note}</Eyebrow>
            <p className="whitespace-pre-wrap text-sm text-ink-2 [overflow-wrap:anywhere]">{req.note}</p>
          </div>
        )}
      </PageBand>

      {/* a draft has no Updates/History yet, but files the client attached (e.g. an unreadable import, AC-NEW-06) must stay visible */}
      {isDraft && dto.documents.length > 0 && (
        <PageBand tone="alt" pad="lg" aria-labelledby="docs-h">
          <h2 id="docs-h" className="mb-3 text-lg font-semibold">{T.tabs.documents} <span className="font-mono text-sm font-normal text-muted-foreground">{dto.documents.length}</span></h2>
          <ul className="sheet" data-testid="draft-documents">{dto.documents.map((d) => <DocumentRow key={d.id} name={d.filename} kind={d.kind as never} bytes={d.bytes} at={d.uploadedAt} href={d.downloadUrl} />)}</ul>
        </PageBand>
      )}

      {!isDraft && (
        <PageBand tone="alt" pad="lg">
          <Tabs defaultValue="updates" className="gap-4">
            <TabsList>
              <TabsTrigger value="updates">{T.tabs.updates}</TabsTrigger>
              {dto.documents.length > 0 && <TabsTrigger value="documents">{T.tabs.documents} <span className="font-mono text-xs text-muted-foreground">{dto.documents.length}</span></TabsTrigger>}
              <TabsTrigger value="history">{T.tabs.history}</TabsTrigger>
            </TabsList>
            <TabsContent value="updates" className="flex flex-col gap-4">
              <div className="rounded-xl border border-border bg-card p-5 [overflow-wrap:anywhere]"><Timeline entries={updates} limit={5} emptyText={T.updatesEmpty} /></div>
              <AskComposer target={{ kind: "request", ref: req.ref }} agentName={agentName} />
            </TabsContent>
            {dto.documents.length > 0 && (
              <TabsContent value="documents"><ul className="sheet">{dto.documents.map((d) => <DocumentRow key={d.id} name={d.filename} kind={d.kind as never} bytes={d.bytes} at={d.uploadedAt} href={d.downloadUrl} />)}</ul></TabsContent>
            )}
            <TabsContent value="history"><div className="rounded-xl border border-border bg-card p-5 [overflow-wrap:anywhere]"><Timeline entries={history} limit={8} emptyText={T.historyEmpty} /></div></TabsContent>
          </Tabs>
        </PageBand>
      )}
    </div>
  );
}
