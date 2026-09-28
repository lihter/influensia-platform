import { useTranslations } from "next-intl";
import Link from "next/link";
import { Triangle, CircleCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type WaitingItem = {
  id: string;
  title: React.ReactNode;
  context?: React.ReactNode;
  due?: React.ReactNode;
  action: { label: string; href: string };
  secondary?: { label: string; href: string };
};

/**
 * DESIGN §5.2 — the single green surface on a client page. `tone="agency"` (info wash, "Waiting on us") and
 * `tone="neutral"` ("Waiting on client") are the ops mirrors. Several items render as sheet rows inside one card.
 */
export function WaitingOnYouCard({ items, tone = "client", eyebrow, emptyTitle, emptyHint, className }: {
  items: WaitingItem[];
  tone?: "client" | "agency" | "neutral";
  eyebrow?: string;
  emptyTitle?: string;
  emptyHint?: string;
  className?: string;
}) {
  const t = useTranslations("waiting");
  const wash = tone === "client" ? "border-green-200 bg-green-50" : tone === "agency" ? "border-info-border bg-info-wash" : "border-neutral-border bg-neutral-wash";
  const divide = tone === "client" ? "divide-green-200" : tone === "agency" ? "divide-info-border" : "divide-neutral-border";
  const pill = tone === "client" ? "border-green-200 bg-green-100 text-green-700" : tone === "agency" ? "border-info-border bg-card text-info" : "border-neutral-border bg-card text-neutral";
  const label = eyebrow ?? (tone === "client" ? t("eyebrow") : tone === "agency" ? t("ops.agency") : t("ops.client"));

  if (!items.length) {
    return (
      <div className={cn("flex items-center gap-3 rounded-xl border border-border bg-card p-5", className)} data-testid="waiting-empty">
        <CircleCheck className="size-5 shrink-0 text-green-600" />
        <div>
          <p className="text-sm font-medium text-foreground">{emptyTitle ?? t("empty")}</p>
          <p className="text-xs text-muted-foreground">{emptyHint ?? t("emptyHint")}</p>
        </div>
      </div>
    );
  }

  return (
    <section className={cn("rounded-xl border p-5", wash, className)} aria-label={label} data-testid="waiting-card">
      <div className="mb-3 flex items-center justify-between">
        <span className={cn("inline-flex h-[22px] items-center gap-1.5 rounded-full border px-2.5 text-2xs font-semibold uppercase tracking-[0.08em]", pill)}>
          <Triangle className="size-2.5 fill-current" />
          {label}
        </span>
        {items.length > 1 && <span className="text-xs text-ink-2">{t("count", { count: items.length })}</span>}
      </div>
      <ul className={cn("divide-y", divide)}>
        {items.map((it) => (
          <li key={it.id} className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between" data-testid="waiting-item">
            <div className="min-w-0">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="text-lg font-semibold leading-7 text-foreground">{it.title}</h2>
                {it.due && <span className="shrink-0 font-mono text-xs text-green-700">{it.due}</span>}
              </div>
              {it.context && <p className="mt-0.5 text-sm text-ink-2">{it.context}</p>}
            </div>
            <div className="flex shrink-0 items-center gap-2 max-sm:[&>*]:flex-1">
              {it.secondary && <Button asChild variant="ghost" size="lg"><Link href={it.secondary.href}>{it.secondary.label}</Link></Button>}
              <Button asChild variant={tone === "client" ? "action" : "outline"} size="lg"><Link href={it.action.href}>{it.action.label}</Link></Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
