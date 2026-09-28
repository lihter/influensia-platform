"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowRight, Check, Lock, Loader2, Trash2, Send, ExternalLink, AlertCircle } from "lucide-react";
import type { ClientRequestPageDto } from "@/server/client/dto/requests";
import type { ActionResult } from "@/server/shared/http";
import { PageHeader } from "@/components/shared/page-header";
import { MilestoneChip, ExceptionChip, UtilityBadge } from "@/components/shared/chips";
import { Timeline, type TimelineEntry } from "@/components/shared/timeline";
import { DocumentRow } from "@/components/shared/document-row";
import { EmptyState } from "@/components/shared/empty-state";
import { Eyebrow } from "@/components/shared/eyebrow";
import { Qty, Ref, DateTime } from "@/components/shared/formatters";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { S } from "./strings";

const T = S.request;
type Act = (input: { requestId: string }) => Promise<ActionResult<{ ref: string }>>;

/**
 * F-06 — request page: header (ref · status · source), optional confirmation card (after send), the lines sheet with
 * milestone chips, then Updates / Documents / History. Drafts get "Send request" and "Delete draft".
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
    else toast.error(r.errors ? Object.values(r.errors)[0] : r.error);
  });
  const del = () => start(async () => {
    const r = await deleteDraft({ requestId: req.id });
    if (r.ok) { toast.success("Draft deleted"); router.push("/app/requests?tab=drafts"); router.refresh(); }
    else toast.error(r.error);
  });

  const updates: TimelineEntry[] = dto.updates.map((u) => ({ id: u.id, kind: u.kind === "comment" ? "note" : u.isActionMilestone ? "action_milestone" : "milestone", at: u.at, title: u.text, author: u.authorName ?? undefined }));
  const history: TimelineEntry[] = dto.history.map((e) => ({ id: e.id, kind: e.isActionMilestone ? "action_milestone" : e.isMilestone ? "milestone" : "system", at: e.at, title: e.text, author: e.actorName ?? undefined }));

  return (
    <>
      <PageHeader
        eyebrow={<span>{dto.companyLabel} · {T.eyebrow}</span>}
        title={<span className="font-mono">{req.ref}</span>}
        titleSuffix={<span>{req.lines.length} {req.lines.length === 1 ? "line" : "lines"}</span>}
        meta={
          <>
            <UtilityBadge kind={isDraft ? "draft" : req.source === "agent_on_behalf" ? "catalog" : "version"}>{isDraft ? T.status.draft : T.source[req.source]}</UtilityBadge>
            <span className="text-xs text-muted-foreground">{req.submittedAt ? <>{T.sent} <DateTime value={req.submittedAt} /></> : <>{T.created} <DateTime value={req.createdAt} /></>}</span>
          </>
        }
        actions={isDraft ? (
          <>
            <Button variant="outline" size="lg" disabled={pending} onClick={() => setConfirmDelete(true)} data-testid="delete-draft"><Trash2 />{T.deleteDraft}</Button>
            <Button size="lg" disabled={pending} onClick={send} data-testid="send-draft">{pending ? <Loader2 className="animate-spin" /> : <Send />}{T.sendDraft}</Button>
          </>
        ) : undefined}
      />

      {confirmDelete && (
        <div className="mb-6 flex flex-col gap-3 rounded-xl border border-danger-border bg-danger-wash p-4 sm:flex-row sm:items-center sm:justify-between" role="alertdialog" aria-label={T.deleteDraft}>
          <p className="flex items-center gap-2 text-sm text-foreground"><AlertCircle className="size-4 text-danger" />{T.deleteConfirm}</p>
          <div className="flex gap-2"><Button variant="ghost" onClick={() => setConfirmDelete(false)}>Cancel</Button><Button variant="destructive" onClick={del} disabled={pending} data-testid="confirm-delete">{T.deleteDraft}</Button></div>
        </div>
      )}

      {justSent && (
        <section className="mb-6 rounded-xl border border-green-200 bg-green-50 p-5" data-testid="sent-confirmation">
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-green-100"><Check className="size-5 text-green-700" /></span>
            <div className="min-w-0 flex-1">
              <Eyebrow className="mb-1">{T.confirmTitle}</Eyebrow>
              <p className="font-mono text-xl font-medium text-foreground">{req.ref}</p>
              <p className="mt-1 text-sm text-ink-2">{T.confirmBody}</p>
            </div>
            <Button asChild variant="outline" className="hidden sm:inline-flex"><Link href="/app/requests/new">{S.newRequest.another}</Link></Button>
          </div>
        </section>
      )}

      {isDraft && <p className="mb-4 text-sm text-ink-2">{T.draftHint}</p>}

      <div className="flex flex-col gap-8">
        <section aria-labelledby="lines-h">
          <h2 id="lines-h" className="mb-2 text-lg font-semibold">{T.linesTitle} <span className="font-mono text-sm font-normal text-muted-foreground">{req.lines.length}</span></h2>
          <ul className="sheet" data-testid="request-lines">
            {req.lines.map((l) => {
              const href = l.orderRef ? `/app/orders/${l.orderRef}` : isDraft ? null : `/app/lines/${l.ref}`;
              const stretched = "after:absolute after:inset-0 after:content-['']";
              return (
                <li key={l.id} className={`sheet-row relative grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2 sm:grid-cols-[1fr_auto_auto] ${href ? "transition-colors duration-[120ms] hover:bg-surface-sunken" : ""}`} data-testid="request-line" data-ref={l.ref}>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Ref muted>{l.orderRef ? `${l.orderRef} · line ${String(l.lineNo).padStart(2, "0")}` : l.ref}</Ref>
                      {l.isRepeat && <UtilityBadge kind="repeat">Repeat</UtilityBadge>}
                      {!l.canEdit && !isDraft && <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" title={T.locked}><Lock className="size-3" />{T.locked}</span>}
                    </div>
                    <div className="truncate text-sm font-medium text-foreground">{href ? <Link href={href} className={stretched}>{l.name}</Link> : l.name}</div>
                    <div className="flex flex-wrap items-center gap-x-2 text-xs text-ink-2">
                      {l.qty !== null && <Qty qty={l.qty} unit={l.unit} />}
                      {l.qty !== null && <span>·</span>}
                      <span data-testid="sub-label">{l.exceptionText ?? l.subLabel}</span>
                      {l.links.map((u) => <a key={u} href={u} target="_blank" rel="noreferrer" className="relative z-10 inline-flex max-w-[16rem] items-center gap-1 truncate font-mono text-muted-foreground hover:text-foreground hover:underline" data-testid="line-link">{u.replace(/^https?:\/\//, "").slice(0, 48)}<ExternalLink className="size-3 shrink-0" /></a>)}
                    </div>
                    {l.note && <p className="mt-1 text-xs text-muted-foreground">“{l.note}”</p>}
                  </div>
                  <div className="flex flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-2">
                    <MilestoneChip milestone={l.milestone} waitingOnClient={!!l.waitingReason} showStep={l.milestoneStep} />
                    {l.exception && <ExceptionChip exception={l.exception} client />}
                  </div>
                  <div className="hidden items-center justify-end text-xs text-ink-2 sm:flex sm:gap-2">
                    <span className="font-mono">{l.etaLabel ?? ""}</span>
                    {href && <ArrowRight className="size-4 text-faint" />}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        {req.note && (
          <section className="rounded-xl border border-border bg-card p-5">
            <Eyebrow className="mb-1.5">{T.note}</Eyebrow>
            <p className="whitespace-pre-wrap text-sm text-ink-2">{req.note}</p>
          </section>
        )}

        <Tabs defaultValue="updates">
          <TabsList>
            <TabsTrigger value="updates">{T.tabs.updates}</TabsTrigger>
            <TabsTrigger value="documents">{T.tabs.documents} <span className="font-mono text-xs text-muted-foreground">{dto.documents.length}</span></TabsTrigger>
            <TabsTrigger value="history">{T.tabs.history}</TabsTrigger>
          </TabsList>
          <TabsContent value="updates" className="pt-4"><div className="rounded-xl border border-border bg-card p-5"><Timeline entries={updates} emptyText={T.updatesEmpty} /></div></TabsContent>
          <TabsContent value="documents" className="pt-4">
            {dto.documents.length ? <ul className="sheet">{dto.documents.map((d) => <DocumentRow key={d.id} name={d.filename} kind={d.kind as never} bytes={d.bytes} at={d.uploadedAt} visibility="client" href={d.downloadUrl} />)}</ul>
              : <div className="rounded-xl border border-border bg-card"><EmptyState title={T.documentsEmpty} className="py-8" /></div>}
          </TabsContent>
          <TabsContent value="history" className="pt-4"><div className="rounded-xl border border-border bg-card p-5"><Timeline entries={history} emptyText={T.historyEmpty} /></div></TabsContent>
        </Tabs>
      </div>
    </>
  );
}
