import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowRight } from "lucide-react";
import type { ClientDashboardDto, ClientWaitingItemDto, ClientActiveLineDto } from "@/server/client/dto";
import { MILESTONES } from "@/db/enums";
import { formatMoney } from "@/server/shared/money";
import { fmtDate, fmtDateShort } from "@/lib/format-date";
import { unitLabel } from "@/lib/labels";
import { WaitingOnYouCard, type WaitingItem } from "@/components/shared/waiting-on-you-card";
import { MilestoneChip, ExceptionChip, UtilityBadge } from "@/components/shared/chips";
import { MilestoneBar } from "@/components/shared/milestone-stepper";
import { Timeline, type TimelineEntry } from "@/components/shared/timeline";
import { EmptyState } from "@/components/shared/empty-state";
import { PageBand } from "@/components/shared/section-band";
import { Qty, Ref } from "@/components/shared/formatters";
import { Button } from "@/components/ui/button";
import { chipLabel, nextStepFor } from "./client-format";
import { NextShort } from "./now-next";

function waitingItem(w: ClientWaitingItemDto, t: ReturnType<typeof useTranslations<"waiting">>): WaitingItem {
  const money = (i: number) => (w.amounts[i] ? formatMoney(w.amounts[i]) : "");
  const date = w.dueOn ? fmtDate(w.dueOn) : null;
  const title =
    w.reason === "offer_sent" ? t("offer_sent", { name: w.name })
    : w.reason === "sample_received" ? t("sample_received", { name: w.name })
    : w.reason === "deposit_due" ? t("deposit_due_nodate", { deposit: money(0), fee: money(1) })
    : w.reason === "artwork_due" ? (w.artworkChangesRequested ? t("artwork_changes", { name: w.name }) : t("artwork_due", { name: w.name }))
    : w.reason === "balance_due" ? t("balance_due_nodate", { amount: money(0) })
    : w.reason === "delivery_confirm" ? t("delivery_confirm", { ref: w.entityRef })
    : t("needs_input", { name: w.name });
  return {
    id: w.id,
    title,
    context: w.reason === "needs_input" && w.questionExcerpt ? `“${w.questionExcerpt}”` : w.reason === "delivery_confirm" ? `${w.name} · delivered ${fmtDateShort(w.since)}` : <Ref muted>{w.entityRef}</Ref>,
    due: date ? `${w.reason === "offer_sent" ? "valid until" : "due"} ${fmtDateShort(w.dueOn)}` : undefined,
    action: { label: t(`button.${w.reason}`), href: w.href },
  };
}

/** One dashboard row: ref · name · qty + detail | chip | 9-segment bar | what's next and when (UX #3). */
function ActiveRow({ l }: { l: ClientActiveLineDto }) {
  const step = nextStepFor({
    milestone: l.milestone, state: l.state, waitingReason: l.waitingReason, exception: l.exception, offerOutcome: l.offerOutcome,
    sourcing: l.sourcingProgress, since: l.lastChangeAt, isRepeat: l.isRepeat, etaLabel: l.etaLabel,
  });
  return (
    <li className="list-none">
      <Link href={l.href} className="sheet-row grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 transition-colors duration-[120ms] hover:bg-surface-sunken md:grid-cols-[minmax(0,1fr)_auto_6.5rem_10.5rem_1rem]" data-testid="active-line" data-ref={l.ref}>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Ref muted>{l.orderRef ? `${l.orderRef} · ${l.ref.slice(-2)}` : l.ref}</Ref>
            {l.isRepeat && <UtilityBadge kind="repeat">Repeat</UtilityBadge>}
          </div>
          <div className="truncate text-sm font-medium text-foreground" title={l.name}>{l.name}</div>
          <div className="truncate text-xs text-ink-2">
            {l.qty !== null && <><Qty qty={l.qty} unit={unitLabel(l.unit, l.qty)} /> · </>}
            <span data-testid="sub-label">{l.exceptionText ?? l.subLabel}</span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 md:flex-row md:items-center md:gap-2">
          {l.exception ? <ExceptionChip exception={l.exception} client /> : <MilestoneChip milestone={l.milestone} waitingOnClient={!!l.waitingReason} label={chipLabel(l)} />}
        </div>
        <div className="hidden pt-2 md:block"><MilestoneBar milestone={l.milestone} /></div>
        {step.short ? <div className="col-span-2 min-w-0 md:col-span-1 md:text-right"><NextShort step={step} className="font-mono" /></div> : <div className="hidden md:block" />}
        <ArrowRight className="hidden size-4 text-faint md:block" aria-hidden />
      </Link>
    </li>
  );
}

/** The client dashboard body (server component; receives the DTO only). Bands: white (waiting) · page (in progress) · alt (updates) · ink (CTA). */
export function ClientDashboardView({ dto }: { dto: ClientDashboardDto }) {
  const t = useTranslations("app.dashboard");
  const tw = useTranslations("waiting");
  const tm = useTranslations("milestone");
  const tn = useTranslations("nav.app");
  const groups = MILESTONES.filter((m) => m !== "delivered").map((m) => ({ m, lines: dto.active.filter((l) => l.milestone === m) })).filter((g) => g.lines.length);
  const entries: TimelineEntry[] = dto.recentUpdates.map((u) => ({
    id: u.id, kind: u.kind === "comment" ? "note" : u.isActionMilestone ? "action_milestone" : "milestone", at: u.at,
    title: u.kind === "comment" ? undefined : u.text, body: u.kind === "comment" ? u.text : undefined,
    author: u.kind === "comment" ? (u.byYou ? "You" : u.authorName ?? undefined) : u.authorName ?? undefined,
  }));
  const waiting = dto.waiting.map((w) => waitingItem(w, tw));

  return (
    <>
      <PageBand tone="white" pad="none" className="pt-5 pb-6" aria-label={tw("eyebrow")}>
        <WaitingOnYouCard items={waiting} />
      </PageBand>

      <PageBand tone="page" pad="lg" aria-labelledby="active-h">
        <div className="mb-4 flex items-baseline justify-between gap-3">
          <h2 id="active-h" className="text-lg font-semibold">{t("active")} <span className="font-mono text-sm font-normal text-muted-foreground">{dto.active.length}</span></h2>
          {dto.deliveredCount > 0 && <Link href="/app/requests?tab=delivered" className="link text-sm">{t("deliveredCount", { count: dto.deliveredCount })}</Link>}
        </div>
        {dto.active.length === 0 ? (
          <div className="rounded-xl border border-border bg-card">
            <EmptyState title={t("activeEmpty")} body={t("activeEmptyHint")} action={<Button asChild variant="action" size="lg"><Link href="/app/requests/new">{tn("newRequest")}</Link></Button>} />
          </div>
        ) : (
          <div className="flex flex-col gap-5" data-testid="active-groups">
            {groups.map((g) => (
              <div key={g.m} data-milestone-group={g.m}>
                <div className="mb-1.5 flex items-center gap-2 text-2xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  {tm(g.m)} <span className="font-mono font-medium">{g.lines.length}</span>
                  <span className="font-mono font-normal normal-case tracking-normal text-faint">· step {MILESTONES.indexOf(g.m) + 1} of 9</span>
                </div>
                <ul className="sheet">{g.lines.map((l) => <ActiveRow key={l.id} l={l} />)}</ul>
              </div>
            ))}
          </div>
        )}
      </PageBand>

      <PageBand tone="alt" pad="lg" aria-labelledby="recent-h">
        <h2 id="recent-h" className="mb-3 text-lg font-semibold">{t("recent")}</h2>
        <div className="rounded-xl border border-border bg-card p-5 [overflow-wrap:anywhere]">
          <Timeline entries={entries} emptyText={t("recentEmpty")} />
        </div>
      </PageBand>

      <PageBand tone="ink" pad="lg">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">{t("ctaTitle")}</h2>
            <p className="text-sm text-white/65">{t("ctaBody")}</p>
          </div>
          <Button asChild variant="action" size="lg"><Link href="/app/requests/new">{t("ctaButton")}</Link></Button>
        </div>
      </PageBand>
    </>
  );
}
