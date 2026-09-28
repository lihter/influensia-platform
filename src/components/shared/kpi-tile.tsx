import Link from "next/link";
import { cn } from "@/lib/utils";

/** DESIGN §5.15 — white card, eyebrow label, 28px mono figure, muted meta; tone dot only when non-zero. Never colours the figure. */
export function KpiTile({ label, value, meta, href, tone = "neutral", className }: { label: string; value: number | string; meta?: string; href?: string; tone?: "warning" | "info" | "neutral"; className?: string }) {
  const nonZero = typeof value === "number" ? value > 0 : true;
  const dot = tone === "warning" ? "bg-warning" : tone === "info" ? "bg-info" : "bg-neutral";
  const body = (
    <>
      <div className="flex items-center gap-2">
        {nonZero && <span className={cn("size-2 rounded-full", dot)} aria-hidden />}
        <span className="text-2xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">{label}</span>
      </div>
      <div className="mt-2 font-mono text-kpi font-semibold tracking-[-0.02em] text-foreground" data-testid="kpi-value">{value}</div>
      {meta && <div className="mt-1 text-xs text-muted-foreground">{meta}</div>}
    </>
  );
  const cls = cn("block rounded-xl border border-hairline-strong bg-card p-5", href && "transition-shadow duration-[120ms] hover:shadow-md", className);
  return href ? <Link href={href} className={cls} data-testid="kpi-tile">{body}</Link> : <div className={cls} data-testid="kpi-tile">{body}</div>;
}
