import { MessageCircle, HelpCircle, Paperclip } from "lucide-react";
import { cn } from "@/lib/utils";
import { VisibilityBadge } from "./chips";
import { DateTime } from "./formatters";
import type { Visibility } from "@/db/enums";

export type TimelineKind = "milestone" | "action_milestone" | "note" | "whatsapp" | "question" | "system" | "document";

export type TimelineEntry = {
  id: string;
  kind: TimelineKind;
  at: Date | string;
  title?: React.ReactNode;
  body?: React.ReactNode;
  author?: string | null;
  visibility?: Visibility;
  /** attachment chips (document names) */
  attachments?: { id: string; name: string; href?: string }[];
  /** ops-only: quoted WhatsApp counterparty */
  counterparty?: string | null;
  action?: React.ReactNode;
};

/**
 * DESIGN §5.12 — <ol> with a 2px connector; date group headers as plain eyebrows; five marker kinds.
 * `showVisibility` for the ops feed (client feeds never receive internal entries in the first place).
 */
export function Timeline({ entries, showVisibility, className, emptyText }: { entries: TimelineEntry[]; showVisibility?: boolean; className?: string; emptyText?: string }) {
  if (!entries.length) return <p className="py-6 text-base text-muted-foreground">{emptyText ?? "—"}</p>;
  const groups: { day: string; items: TimelineEntry[] }[] = [];
  for (const e of entries) {
    const day = new Date(e.at).toISOString().slice(0, 10);
    const g = groups[groups.length - 1];
    if (g && g.day === day) g.items.push(e); else groups.push({ day, items: [e] });
  }
  return (
    <div className={className} data-testid="timeline">
      {groups.map((g) => (
        <section key={g.day} className="border-t border-hairline-faint pt-3 first:border-t-0 first:pt-0">
          <div className="mb-2 text-2xs font-semibold uppercase tracking-[0.08em] text-muted-foreground"><DateTime value={g.day} variant="short" className="font-sans" /></div>
          <ol className="relative ml-2 border-l-2 border-border pl-5">
            {g.items.map((e) => <TimelineItem key={e.id} entry={e} showVisibility={showVisibility} />)}
          </ol>
        </section>
      ))}
    </div>
  );
}

export function TimelineItem({ entry: e, showVisibility }: { entry: TimelineEntry; showVisibility?: boolean }) {
  const internal = e.visibility === "internal";
  return (
    <li className="relative pb-5 last:pb-3" data-kind={e.kind}>
      <span className="absolute -left-[29px] top-1 flex size-4 items-center justify-center" aria-hidden>
        {e.kind === "milestone" && <span className="size-3 rounded-full bg-foreground ring-4 ring-background" />}
        {e.kind === "action_milestone" && <span className="size-3 rounded-full bg-green-600 ring-4 ring-background" />}
        {e.kind === "note" && <span className="size-3 rounded-full border-2 border-foreground bg-card ring-4 ring-background" />}
        {e.kind === "whatsapp" && <MessageCircle className="size-4 bg-background text-muted-foreground" />}
        {e.kind === "question" && <HelpCircle className="size-4 bg-background text-info" />}
        {e.kind === "document" && <Paperclip className="size-4 bg-background text-muted-foreground" />}
        {e.kind === "system" && <span className="size-2 rounded-full bg-border ring-4 ring-background" />}
      </span>
      <div className={cn("flex items-start justify-between gap-3", e.kind === "system" && "text-xs text-muted-foreground")}>
        <div className="min-w-0 flex-1">
          {(e.kind === "whatsapp" || e.kind === "question" || (showVisibility && e.visibility)) && (
            <div className="mb-1 flex flex-wrap items-center gap-1.5">
              {e.kind === "whatsapp" && <span className="inline-flex h-[22px] items-center rounded-md border border-neutral-border bg-neutral-wash px-2 text-2xs font-semibold uppercase tracking-[0.06em] text-neutral">WhatsApp</span>}
              {e.kind === "question" && <span className="inline-flex h-[22px] items-center rounded-md border border-info-border bg-info-wash px-2 text-2xs font-semibold uppercase tracking-[0.06em] text-info">Client question</span>}
              {showVisibility && e.visibility && <VisibilityBadge visibility={e.visibility} />}
              {e.author && <span className="text-xs text-muted-foreground">{e.author}{e.counterparty ? ` ↔ ${e.counterparty}` : ""}</span>}
            </div>
          )}
          {e.title && <p className={cn("text-sm font-medium text-foreground", e.kind === "system" && "font-normal text-muted-foreground")}>{e.title}</p>}
          {e.body && (
            e.kind === "whatsapp" ? <blockquote className="mt-1 border-l-2 border-hairline-strong pl-3 text-sm text-ink-2">{e.body}</blockquote>
            : internal && showVisibility ? <div className="mt-1 rounded-lg bg-section-alt px-3 py-2 text-sm text-foreground">{e.body}</div>
            : <p className="mt-0.5 text-sm text-ink-2">{e.body}</p>
          )}
          {!showVisibility && e.author && !(e.kind === "whatsapp" || e.kind === "question") && <p className="mt-0.5 text-xs text-muted-foreground">{e.author}</p>}
          {e.attachments?.length ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {e.attachments.map((a) => (
                <a key={a.id} href={a.href} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-card px-2 text-xs text-foreground hover:bg-surface-sunken"><Paperclip className="size-3 text-muted-foreground" />{a.name}</a>
              ))}
            </div>
          ) : null}
          {e.action && <div className="mt-2">{e.action}</div>}
        </div>
        <DateTime value={e.at} variant="datetime" className="shrink-0 text-xs text-muted-foreground" />
      </div>
    </li>
  );
}
