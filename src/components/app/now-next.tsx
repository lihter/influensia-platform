import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { whenText, type NextStep } from "./client-format";

/**
 * Signature touch #1 — the "Now → Next" strip under the stepper: one line that answers the only question a client has
 * ("when will I hear back?"). `detail` is the state's sub-label ("3 contacted · 2 quoted"), shown once, here.
 */
export function NowNextStrip({ step, detail, className }: { step: NextStep; detail?: string | null; className?: string }) {
  const when = whenText(step);
  return (
    <div className={cn("grid gap-3 rounded-lg border border-hairline-strong bg-section-alt px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center sm:gap-5", className)} data-testid="now-next">
      <div className="min-w-0">
        <p className="eyebrow">Now</p>
        <p className="mt-0.5 text-sm font-medium text-foreground [overflow-wrap:anywhere]" data-testid="now-text">{step.now}</p>
        {detail && detail !== step.now && <p className="text-xs text-ink-2" data-testid="sub-label">{detail}</p>}
      </div>
      {step.next && <ArrowRight className="hidden size-4 text-faint sm:block" aria-hidden />}
      {step.next && (
        <div className="min-w-0 border-t border-hairline-strong pt-3 sm:border-t-0 sm:pt-0">
          <p className="eyebrow">Next</p>
          <p className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-sm text-foreground" data-testid="next-text">
            <span className="font-medium">{step.next}</span>
            {when && <span className="font-mono text-xs text-ink-2" data-testid="next-when">{when}</span>}
          </p>
        </div>
      )}
    </div>
  );
}

/** Compact "what's next" phrase for list rows: `Price by ~3 Oct` (never a lone dash — nothing when unknown). */
export function NextShort({ step, className }: { step: NextStep; className?: string }) {
  if (!step.short) return null;
  return <span className={cn("text-xs text-ink-2", step.party === "client" && "font-medium text-green-700", className)} data-testid="next-short">{step.short}</span>;
}
