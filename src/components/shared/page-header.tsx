import { cn } from "@/lib/utils";
import { Eyebrow } from "./eyebrow";

/**
 * DESIGN §4.2: eyebrow → H1 → meta row → tabs; actions right-aligned on the H1 (phone: full-width row below).
 * `sticky` for ops detail pages.
 */
export function PageHeader({ eyebrow, eyebrowVariant = "plain", title, titleSuffix, meta, actions, tabs, sticky, className }: {
  eyebrow?: React.ReactNode;
  eyebrowVariant?: "plain" | "pill";
  title: React.ReactNode;
  /** right-aligned muted mono text on the title row, e.g. "Quality check · 7 of 9" */
  titleSuffix?: React.ReactNode;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  tabs?: React.ReactNode;
  sticky?: boolean;
  className?: string;
}) {
  return (
    <header className={cn("mb-6", sticky && "sticky top-0 z-30 -mx-6 border-b border-border bg-background/95 px-6 pt-4 backdrop-blur-sm", className)}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          {eyebrow && <Eyebrow variant={eyebrowVariant} className="mb-1.5">{eyebrow}</Eyebrow>}
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="text-xl font-semibold tracking-[-0.01em] text-foreground">{title}</h1>
            {titleSuffix && <span className="font-mono text-xs text-muted-foreground">{titleSuffix}</span>}
          </div>
          {meta && <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-ink-2">{meta}</div>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end [&>*]:max-sm:flex-1">{actions}</div>}
      </div>
      {tabs && <div className="mt-4">{tabs}</div>}
    </header>
  );
}
