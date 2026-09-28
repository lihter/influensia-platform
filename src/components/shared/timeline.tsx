"use client";
import * as React from "react";
import { MessageCircle, HelpCircle, Paperclip, Eye } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { VisibilityBadge } from "./chips";
import { dayKey, fmtDate, fmtDateShort, fmtTime, fmtDateTime } from "@/lib/format-date";
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
 * `timeOnly` (default true): items show `14:05` because the day lives in the group header; on phones the time moves to
 * the author line. `collapse` (default true): consecutive entries with the same text title within 10 minutes fold into
 * one item with a `×N` count. `limit`: show the latest N entries (entries are newest-first) + "Show all N updates".
 */
export function Timeline({ entries, showVisibility, className, emptyText, timeOnly = true, collapse = true, limit }: { entries: TimelineEntry[]; showVisibility?: boolean; className?: string; emptyText?: string; timeOnly?: boolean; collapse?: boolean; limit?: number }) {
  const [all, setAll] = React.useState(false);
  const folded = React.useMemo(() => (collapse ? collapseRuns(entries) : entries.map((e) => ({ entry: e, count: 1 }))), [entries, collapse]);
  if (!entries.length) return <p className="py-6 text-base text-muted-foreground">{emptyText ?? "—"}</p>;
  const shown = limit && !all ? folded.slice(0, limit) : folded;
  const groups: { day: string; at: TimelineEntry["at"]; items: { entry: TimelineEntry; count: number }[] }[] = [];
  for (const f of shown) {
    const day = dayKey(f.entry.at);
    const g = groups[groups.length - 1];
    if (g && g.day === day) g.items.push(f); else groups.push({ day, at: f.entry.at, items: [f] });
  }
  const thisYear = dayKey(new Date()).slice(0, 4);
  return (
    <div className={className} data-testid="timeline">
      {groups.map((g) => (
        <section key={g.day} className="border-t border-hairline-faint pt-3 first:border-t-0 first:pt-0">
          <div className="mb-2 text-2xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            <time dateTime={g.day}>{g.day.slice(0, 4) === thisYear ? fmtDateShort(g.at) : fmtDate(g.at)}</time>
          </div>
          <ol className="relative ml-2 border-l-2 border-border pl-5">
            {g.items.map((f) => <TimelineItem key={f.entry.id} entry={f.entry} count={f.count} showVisibility={showVisibility} timeOnly={timeOnly} />)}
          </ol>
        </section>
      ))}
      {limit && folded.length > limit && (
        <Button type="button" variant="ghost" size="sm" className="mt-1 text-link" onClick={() => setAll((v) => !v)} aria-expanded={all}>
          {all ? "Show latest only" : `Show all ${folded.length} updates`}
        </Button>
      )}
    </div>
  );
}

/** Fold consecutive entries that say the same thing (same kind + plain-text title + body) within 10 minutes. */
function collapseRuns(entries: TimelineEntry[]): { entry: TimelineEntry; count: number }[] {
  const out: { entry: TimelineEntry; count: number; lastAt: number }[] = [];
  const key = (e: TimelineEntry) => (typeof e.title === "string" ? `${e.kind}|${e.title}|${typeof e.body === "string" ? e.body : e.body ? "∎" + e.id : ""}|${e.visibility ?? ""}` : null);
  for (const e of entries) {
    const k = key(e);
    const prev = out[out.length - 1];
    const t = new Date(e.at).getTime();
    if (k && prev && key(prev.entry) === k && !e.attachments?.length && !e.action && Math.abs(prev.lastAt - t) <= 10 * 60_000) { prev.count++; prev.lastAt = t; continue; }
    out.push({ entry: e, count: 1, lastAt: t });
  }
  return out.map(({ entry, count }) => ({ entry, count }));
}

export function TimelineItem({ entry: e, showVisibility, timeOnly = true, count = 1 }: { entry: TimelineEntry; showVisibility?: boolean; timeOnly?: boolean; count?: number }) {
  const when = timeOnly ? fmtTime(e.at) : fmtDateTime(e.at);
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
              {showVisibility && e.visibility === "internal" && <VisibilityBadge visibility="internal" />}
              {showVisibility && e.visibility === "client" && <span className="inline-flex items-center text-muted-foreground" title="Visible to the client"><Eye className="size-3.5" aria-hidden /><span className="sr-only">Visible to the client</span></span>}
              {e.author && <span className="text-xs text-muted-foreground">{e.author}{e.counterparty ? ` ↔ ${e.counterparty}` : ""}</span>}
            </div>
          )}
          {e.title && <p className={cn("text-sm font-medium text-foreground", e.kind === "system" && "font-normal text-muted-foreground")}>{e.title}{count > 1 && <span className="ml-1.5 font-mono text-xs font-normal text-muted-foreground" title={`${count} identical updates`}>×{count}</span>}</p>}
          {e.body && (
            e.kind === "whatsapp" ? <blockquote className="mt-1 border-l-2 border-hairline-strong pl-3 text-sm text-ink-2">{e.body}</blockquote>
            : internal && showVisibility ? <div className="mt-1 rounded-lg bg-section-alt px-3 py-2 text-sm text-foreground">{e.body}</div>
            : <p className="mt-0.5 text-sm text-ink-2">{e.body}</p>
          )}
          {!showVisibility && e.author && !(e.kind === "whatsapp" || e.kind === "question") && <p className="mt-0.5 text-xs text-muted-foreground">{e.author}<span className="sm:hidden"> · <time className="font-mono" dateTime={new Date(e.at).toISOString()}>{when}</time></span></p>}
          {e.attachments?.length ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {e.attachments.map((a) => (
                <a key={a.id} href={a.href} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-card px-2 text-xs text-foreground hover:bg-surface-sunken"><Paperclip className="size-3 text-muted-foreground" />{a.name}</a>
              ))}
            </div>
          ) : null}
          {e.action && <div className="mt-2">{e.action}</div>}
        </div>
        <time dateTime={new Date(e.at).toISOString()} title={fmtDateTime(e.at)} className={cn("shrink-0 font-mono text-xs tabular-nums text-muted-foreground", !showVisibility && e.author && !(e.kind === "whatsapp" || e.kind === "question") && "max-sm:hidden")}>{when}</time>
      </div>
    </li>
  );
}
