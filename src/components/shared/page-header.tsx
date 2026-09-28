import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { Eyebrow } from "./eyebrow";
import { StickyHeaderVar } from "./sticky-header-var";

export type Crumb = { href?: string; label: React.ReactNode };

/**
 * DESIGN §4.2: breadcrumb → eyebrow → H1 → meta row → tabs; actions right-aligned on the H1 (phone: full-width row below).
 * `band` renders the header as the full-bleed WHITE band (section-band.tsx); `sticky` implies `band` (ops detail pages).
 * `crumbs` renders a breadcrumb trail above the eyebrow ("Requests › REQ-2026-0312 › 02"); the last crumb is the page.
 * When a page has a band header, its content should follow in <PageBand> sections (page / alt).
 */
export function PageHeader({ eyebrow, eyebrowVariant = "plain", title, titleSuffix, meta, actions, tabs, sticky, band, crumbs, className }: {
  eyebrow?: React.ReactNode;
  eyebrowVariant?: "plain" | "pill";
  title: React.ReactNode;
  /** right-aligned muted mono text on the title row, e.g. "Quality check · 7 of 9" */
  titleSuffix?: React.ReactNode;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  tabs?: React.ReactNode;
  sticky?: boolean;
  band?: boolean;
  crumbs?: Crumb[];
  className?: string;
}) {
  const isBand = band || sticky;
  return (
    <header
      data-band={isBand ? "white" : undefined}
      className={cn(
        isBand ? cn("band-white pt-5", tabs ? "pb-0" : "pb-5") : "mb-6",
        sticky && "sticky top-0 z-30",
        className,
      )}
    >
      {sticky && <StickyHeaderVar />}
      {crumbs && crumbs.length > 0 && <Breadcrumbs crumbs={crumbs} className="mb-2" />}
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
      {tabs && <div className={cn(isBand ? "mt-3" : "mt-4")}>{tabs}</div>}
    </header>
  );
}

/** Breadcrumb trail: 12px, links in ink-2 with hover underline; the current page is not a link. */
export function Breadcrumbs({ crumbs, className }: { crumbs: Crumb[]; className?: string }) {
  return (
    <nav aria-label="Breadcrumb" className={cn("text-xs", className)}>
      <ol className="flex flex-wrap items-center gap-1 text-muted-foreground">
        {crumbs.length === 1 && crumbs[0].href && <ChevronLeft className="size-3.5" aria-hidden />}
        {crumbs.map((c, i) => (
          <li key={i} className="flex items-center gap-1">
            {i > 0 && <span aria-hidden className="text-faint">/</span>}
            {c.href && i < crumbs.length - (crumbs.length > 1 ? 1 : 0) ? (
              <Link href={c.href} className="text-ink-2 underline-offset-[3px] hover:text-foreground hover:underline decoration-hairline-strong">{c.label}</Link>
            ) : (
              <span aria-current={i === crumbs.length - 1 ? "page" : undefined} className="text-muted-foreground">{c.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** A ref / name inside an eyebrow that navigates: `REQ-2026-0312` → request page. Inherits eyebrow type. */
export function EyebrowLink({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) {
  return <Link href={href} className={cn("underline-offset-[3px] decoration-hairline-strong hover:text-foreground hover:underline", className)}>{children}</Link>;
}
