import { useTranslations } from "next-intl";
import { Check, Triangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { MILESTONES, type Milestone, type LineState } from "@/db/enums";
import { ACTION_MILESTONES, milestoneIndex } from "@/server/shared/state-machine";

export type StepperProps = {
  milestone: Milestone;
  /** the current step shows the client sub-label (SPEC §3.3) */
  subLabel?: string;
  /** ▲ step that waits on the client: blocked marker + "Your action" */
  waitingOnClient?: boolean;
  /** `sample` rendered as skipped when an order was confirmed without one */
  sampleSkipped?: boolean;
  /** ops variant: internal state under the current step */
  state?: LineState;
  /** "summary" forces the phone layout at every width (dashboard rows) */
  variant?: "full" | "summary";
  className?: string;
};

/** The 9-segment bar alone (dashboard rows, DESIGN §6.1). */
export function MilestoneBar({ milestone, sampleSkipped, className }: { milestone: Milestone; sampleSkipped?: boolean; className?: string }) {
  const t = useTranslations("milestone");
  const cur = milestoneIndex(milestone);
  return (
    <ol className={cn("grid grid-cols-9 gap-1", className)} aria-label={t("stepLabel", { step: cur + 1, name: t(milestone) })}>
      {MILESTONES.map((m, i) => (
        <li key={m} aria-current={i === cur ? "step" : undefined} className="relative">
          {ACTION_MILESTONES.includes(m) && <Triangle className={cn("absolute -top-2.5 left-1/2 size-1.5 -translate-x-1/2", i <= cur ? "fill-green-600 text-green-600" : "text-faint")} aria-hidden />}
          <div className={cn("h-1 rounded-full transition-colors duration-[120ms]", i < cur ? "bg-foreground" : i === cur ? "bg-green-600" : "bg-border", m === "sample" && sampleSkipped && "bg-hairline-strong")} />
          <span className="sr-only">{t(m)}</span>
        </li>
      ))}
    </ol>
  );
}

/**
 * DESIGN §5.1 — nine steps; done / current / todo / blocked; ▲ markers on action milestones.
 * Desktop: horizontal <ol> with aria-current="step". Phone (<768px) or variant="summary": "Step 7 of 9 · Quality check" + 9-segment bar.
 */
export function MilestoneStepper({ milestone, subLabel, waitingOnClient, sampleSkipped, state, variant = "full", className }: StepperProps) {
  const t = useTranslations("milestone");
  const cur = milestoneIndex(milestone);
  const summary = (
    <div className={cn("flex flex-col gap-2", variant === "full" && "md:hidden")} data-testid="stepper-summary">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-medium text-foreground">
          <span className="font-mono">{t("stepShort", { step: cur + 1 })}</span> · {t(milestone)}
        </span>
        {waitingOnClient && <span className="inline-flex items-center gap-1 text-2xs font-semibold text-green-700"><Triangle className="size-2 fill-current" />{t("yourAction")}</span>}
      </div>
      <MilestoneBar milestone={milestone} sampleSkipped={sampleSkipped} />
      {subLabel && <p className="text-xs text-ink-2">{subLabel}</p>}
    </div>
  );
  if (variant === "summary") return <div className={className}>{summary}</div>;

  return (
    <div className={className}>
      {summary}
      <ol className="hidden md:flex" data-testid="stepper">
        {MILESTONES.map((m, i) => {
          const done = i < cur;
          const current = i === cur;
          const action = ACTION_MILESTONES.includes(m);
          const skipped = m === "sample" && sampleSkipped && !current;
          const blocked = current && action && waitingOnClient;
          return (
            <li key={m} aria-current={current ? "step" : undefined} className="relative flex flex-1 flex-col items-center text-center">
              {/* connector: from this dot's centre to the next */}
              {i < MILESTONES.length - 1 && <div className={cn("absolute top-[9px] left-1/2 h-0.5 w-full", done ? "bg-foreground" : "bg-border")} aria-hidden />}
              <div className="relative flex h-5 items-center justify-center">
                {action && !current && <Triangle className={cn("absolute -top-2 size-2", done ? "fill-foreground text-foreground" : "text-faint")} aria-hidden />}
                {blocked && <Triangle className="absolute -top-2.5 size-2 fill-green-600 text-green-600" aria-label={t("yourAction")} />}
                {done ? (
                  <span className="relative z-10 flex size-3.5 items-center justify-center rounded-full bg-foreground text-white"><Check className="size-2.5" strokeWidth={3} /></span>
                ) : current ? (
                  <span className="relative z-10 flex size-[18px] items-center justify-center rounded-full border-2 border-green-600 bg-green-100"><span className="size-1.5 rounded-full bg-green-600" /></span>
                ) : (
                  <span className={cn("relative z-10 size-2.5 rounded-full border bg-card", skipped ? "border-dashed border-hairline-strong" : "border-hairline-strong")} />
                )}
              </div>
              <div className={cn("mt-2 px-1 text-xs leading-4", done ? "text-ink-2" : current ? "font-semibold text-foreground" : "text-muted-foreground", skipped && "line-through")}>
                {t(m)}
              </div>
              {current && subLabel && <div className="mt-0.5 max-w-[12rem] px-1 text-2xs leading-4 text-ink-2">{subLabel}</div>}
              {blocked && <div className="mt-0.5 text-2xs font-semibold text-green-700">{t("yourAction")}</div>}
              {current && state && <div className="mt-0.5 font-mono text-2xs text-muted-foreground">{state}</div>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
