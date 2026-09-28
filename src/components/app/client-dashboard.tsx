import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowRight } from "lucide-react";
import type { ClientDashboardDto, ClientWaitingItemDto } from "@/server/client/dto";
import { MILESTONES } from "@/db/enums";
import { formatMoney } from "@/server/shared/money";
import { formatDate } from "@/server/shared/dates";
import { WaitingOnYouCard, type WaitingItem } from "@/components/shared/waiting-on-you-card";
import { MilestoneChip, ExceptionChip, UtilityBadge } from "@/components/shared/chips";
import { MilestoneBar } from "@/components/shared/milestone-stepper";
import { Timeline, type TimelineEntry } from "@/components/shared/timeline";
import { EmptyState } from "@/components/shared/empty-state";
import { Qty, Ref } from "@/components/shared/formatters";
import { Button } from "@/components/ui/button";

function waitingItem(w: ClientWaitingItemDto, t: ReturnType<typeof useTranslations<"waiting">>): WaitingItem {
  const money = (i: number) => (w.amounts[i] ? formatMoney(w.amounts[i]) : "");
  const date = w.dueOn ? formatDate(w.dueOn) : null;
  const title =
    w.reason === "offer_sent" ? t("offer_sent", { name: w.name })
    : w.reason === "sample_received" ? t("sample_received", { name: w.name })
    : w.reason === "deposit_due" ? (date ? t("deposit_due", { deposit: money(0), fee: money(1), date }) : t("deposit_due_nodate", { deposit: money(0), fee: money(1) }))
    : w.reason === "artwork_due" ? (w.artworkChangesRequested ? t("artwork_changes", { name: w.name }) : t("artwork_due", { name: w.name }))
    : w.reason === "balance_due" ? (date ? t("balance_due", { amount: money(0), date }) : t("balance_due_nodate", { amount: money(0) }))
    : w.reason === "delivery_confirm" ? t("delivery_confirm", { ref: w.entityRef })
    : t("needs_input", { name: w.name });
  return {
    id: w.id,
    title,
    context: w.reason === "needs_input" && w.questionExcerpt ? `“${w.questionExcerpt}”` : w.reason === "offer_sent" && date ? t("offer_sent_meta", { date }) : <Ref muted>{w.entityRef}</Ref>,
    due: w.dueOn ? `due ${formatDate(w.dueOn, "d MMM")}` : undefined,
    action: { label: t(`button.${w.reason}`), href: w.href },
  };
}

/** The client dashboard body (server component; receives the DTO only). */
export function ClientDashboardView({ dto }: { dto: ClientDashboardDto }) {
  const t = useTranslations("app.dashboard");
  const tw = useTranslations("waiting");
  const tm = useTranslations("milestone");
  const tn = useTranslations("nav.app");
  const groups = MILESTONES.filter((m) => m !== "delivered").map((m) => ({ m, lines: dto.active.filter((l) => l.milestone === m) })).filter((g) => g.lines.length);
  const entries: TimelineEntry[] = dto.recentUpdates.map((u) => ({ id: u.id, kind: u.kind === "comment" ? "note" : u.isActionMilestone ? "action_milestone" : "milestone", at: u.at, title: u.text, author: u.authorName ?? undefined }));

  return (
    <div className="flex flex-col gap-8">
      <WaitingOnYouCard items={dto.waiting.map((w) => waitingItem(w, tw))} />

      <section aria-labelledby="active-h">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 id="active-h" className="text-lg font-semibold">{t("active")} <span className="font-mono text-sm font-normal text-muted-foreground">{dto.active.length}</span></h2>
          {dto.deliveredCount > 0 && <Link href="/app/requests" className="link text-sm">{t("deliveredCount", { count: dto.deliveredCount })}</Link>}
        </div>
        {dto.active.length === 0 ? (
          <div className="rounded-xl border border-border bg-card">
            <EmptyState title={t("activeEmpty")} body={t("activeEmptyHint")} action={<Button asChild><Link href="/app/requests/new">{tn("newRequest")}</Link></Button>} />
          </div>
        ) : (
          <div className="flex flex-col gap-5" data-testid="active-groups">
            {groups.map((g) => (
              <div key={g.m} data-milestone-group={g.m}>
                <div className="mb-1.5 flex items-center gap-2 text-2xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  <span className="font-mono">{String(MILESTONES.indexOf(g.m) + 1).padStart(2, "0")}</span> · {tm(g.m)} <span className="font-mono">{g.lines.length}</span>
                </div>
                <ul className="sheet">
                  {g.lines.map((l) => (
                    <li key={l.id} className="list-none">
                      <Link href={l.href} className="sheet-row grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2 transition-colors duration-[120ms] hover:bg-surface-sunken sm:grid-cols-[1fr_auto_6rem_auto]" data-testid="active-line" data-ref={l.ref}>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <Ref muted>{l.orderRef ? `${l.orderRef} · ${l.ref.slice(-2)}` : l.ref}</Ref>
                            {l.isRepeat && <UtilityBadge kind="repeat">Repeat</UtilityBadge>}
                          </div>
                          <div className="truncate text-sm font-medium text-foreground">{l.name}</div>
                          <div className="text-xs text-ink-2">
                            {l.qty !== null && <><Qty qty={l.qty} unit={l.unit} /> · </>}
                            <span data-testid="sub-label">{l.subLabel}</span>
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-2">
                          <MilestoneChip milestone={l.milestone} waitingOnClient={!!l.waitingReason} />
                          {l.exception && <ExceptionChip exception={l.exception} client />}
                        </div>
                        <div className="hidden pt-2 sm:block"><MilestoneBar milestone={l.milestone} /></div>
                        <div className="col-span-2 flex items-center justify-between text-xs text-ink-2 sm:col-span-1 sm:justify-end sm:gap-2">
                          <span className="font-mono" data-testid="eta">{l.etaLabel ?? "—"}</span>
                          <ArrowRight className="size-4 text-faint" />
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="recent-h">
        <h2 id="recent-h" className="mb-3 text-lg font-semibold">{t("recent")}</h2>
        <div className="rounded-xl border border-border bg-card p-5">
          <Timeline entries={entries} emptyText={t("recentEmpty")} />
        </div>
      </section>

      <section className="rounded-xl bg-inverse p-6 text-white">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">{t("ctaTitle")}</h2>
            <p className="text-sm text-white/65">{t("ctaBody")}</p>
          </div>
          <Button asChild variant="action" size="lg"><Link href="/app/requests/new">{t("ctaButton")}</Link></Button>
        </div>
      </section>
    </div>
  );
}
