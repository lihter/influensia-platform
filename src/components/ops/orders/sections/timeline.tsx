"use client";
import * as React from "react";
import type { OpsOrderDetail, OpsTimelineEntry } from "@/server/ops/orders";
import { Timeline, type TimelineEntry } from "@/components/shared/timeline";
import { FormShell } from "@/components/shared/form-shell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { postNoteAction, answerQuestionAction, logWhatsAppAction } from "@/app/(ops)/ops/orders/actions";
import { OrderSection, useAct, TextField, TextareaField, fd, str } from "../ui";
import { cn } from "@/lib/utils";

type Filter = "all" | "milestones" | "notes" | "whatsapp" | "questions";

/** 08 Timeline — full feed (activity + comments, visibility badges), filter chips, Internal note / Client update (leak-checked) / Log WhatsApp / Reply. */
export function TimelineSection({ d }: { d: OpsOrderDetail }) {
  const o = d.order;
  const [filter, setFilter] = React.useState<Filter>("all");
  const openQuestions = d.timeline.filter((e) => e.kind === "question").length;
  const entries: TimelineEntry[] = d.timeline
    .filter((e) => filter === "all" || (filter === "milestones" && (e.kind === "milestone" || e.kind === "action_milestone")) || (filter === "notes" && e.kind === "note") || (filter === "whatsapp" && e.kind === "whatsapp") || (filter === "questions" && e.kind === "question"))
    .map((e) => ({ id: e.id, kind: e.kind, at: e.at, title: e.title ?? undefined, body: e.body ?? undefined, author: e.author, visibility: e.visibility, counterparty: e.counterparty, attachments: e.attachments, action: e.kind === "question" ? <ReplySheet orderId={o.id} orderRef={o.ref} question={e} /> : undefined }));
  return (
    <OrderSection id="timeline" number={8} title="Timeline" count={openQuestions} action={<span className="inline-flex gap-2"><NoteSheet orderId={o.id} orderRef={o.ref} visibility="internal" /><NoteSheet orderId={o.id} orderRef={o.ref} visibility="client" /><WaSheet orderId={o.id} orderRef={o.ref} /></span>}>
      <div className="mb-4 flex flex-wrap gap-1.5" role="tablist" aria-label="Filter">
        {([["all", "All"], ["milestones", "Milestones"], ["notes", "Notes"], ["whatsapp", "WhatsApp"], ["questions", "Client questions"]] as [Filter, string][]).map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={filter === k} onClick={() => setFilter(k)} className={cn("h-7 rounded-full border px-2.5 text-xs font-medium transition-colors", filter === k ? "border-foreground bg-foreground text-white" : "border-border bg-card text-ink-2 hover:bg-surface-sunken")}>{l}</button>
        ))}
      </div>
      <Timeline entries={entries} showVisibility emptyText="Nothing here yet." />
    </OrderSection>
  );
}

function NoteSheet({ orderId, orderRef, visibility }: { orderId: string; orderRef: string; visibility: "client" | "internal" }) {
  const { act } = useAct();
  const client = visibility === "client";
  return (
    <FormShell trigger={<Button size="sm" variant={client ? "default" : "outline"} data-testid={client ? "post-update" : "post-note"}>{client ? "Client update" : "Internal note"}</Button>} eyebrow={orderRef} title={client ? "Post a client-visible update" : "Internal note"} description={client ? "Leak-checked before it is saved; the client is emailed." : "Only the team sees this."} submitLabel={client ? "Post update" : "Save note"}
      onSubmit={async (e) => { const f = fd(e); return act(() => postNoteAction({ orderId, body: str(f, "body"), visibility }), { success: client ? "Update posted" : "Note saved" }); }}>
      <TextareaField name="body" label={client ? "Update" : "Note"} rows={5} required />
    </FormShell>
  );
}

function WaSheet({ orderId, orderRef }: { orderId: string; orderRef: string }) {
  const { act } = useAct();
  return (
    <FormShell trigger={<Button size="sm" variant="outline" data-testid="log-whatsapp">Log WhatsApp</Button>} eyebrow={orderRef} title="Log WhatsApp" submitLabel="Log"
      onSubmit={async (e) => { const f = fd(e); return act(() => logWhatsAppAction({ orderId, counterparty: str(f, "counterparty"), body: str(f, "body") }), { success: "WhatsApp logged" }); }}>
      <TextField name="counterparty" label="Counterparty" placeholder="Daryl (factory)" required />
      <TextareaField name="body" label="Pasted text" rows={6} required />
    </FormShell>
  );
}

function ReplySheet({ orderId, orderRef, question }: { orderId: string; orderRef: string; question: OpsTimelineEntry }) {
  const { act } = useAct();
  return (
    <FormShell trigger={<Button size="sm" variant="outline">Reply</Button>} eyebrow={orderRef} title="Reply to the client" submitLabel="Send reply"
      onSubmit={async (e) => { const f = fd(e); return act(() => answerQuestionAction({ orderId, body: str(f, "body") }), { success: "Reply posted" }); }}>
      <blockquote className="border-l-2 border-hairline-strong pl-3 text-sm text-ink-2">{question.body}</blockquote>
      <Textarea name="body" rows={5} required placeholder="Your answer (client-visible, leak-checked)" />
    </FormShell>
  );
}
