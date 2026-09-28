/**
 * SECTION BANDS — the page rhythm (FIX_PHASE contract a, UX_REVIEW top #1, DESIGN §4.4).
 *
 * Three grounds, always in this meaning:
 *   white — chrome and "now": the page header, the waiting/action zone          (bg-card, hairline bottom)
 *   page  — the working content: tables, forms, cards                           (#FAFAF7 = bg-background, no rules)
 *   alt   — secondary / aside: rails, history, "what happens next", filters     (bg-section-alt, hairline-strong top+bottom)
 *   ink   — one closing CTA band per page at most (client dashboard)            (bg-inverse)
 *
 * <PageBand> is FULL-BLEED without layout tricks: the background is painted with a `border-image` outset (ink overflow,
 * never causes horizontal scroll), so it works inside any padded / max-width container. Content stays in the container.
 * Put bands directly in the page (not inside cards). Cards (white) may sit on page or alt bands; never a card on a card.
 *
 *   <PageBand tone="white" pad="none">…header…</PageBand>            // or <PageHeader band … /> which does this for you
 *   <PageBand tone="page">…main content…</PageBand>                   // default tone, py-6
 *   <PageBand tone="alt" pad="lg" inner="max-w-[72rem]">…</PageBand> // inner = optional max-width wrapper (client pages)
 *   <PageBand tone="alt" as="aside" fill>…</PageBand>                // fill = stretch to the bottom of the viewport
 *
 * Props: tone ("white" | "page" | "alt" | "ink"), pad ("none" | "sm" 16px | "md" 24px | "lg" 32px), inner (className for
 * the inner container; defaults to full container width), as, id (anchor targets get scroll-mt), className, fill.
 * Ops: the ops shell clips band overflow at the content column, so bands never paint under the sidebar.
 *
 * <SectionBand> (below) is the older, NOT full-bleed alt strip (filters, compare bar) — keep for inline strips.
 * <BandSection> is a numbered section inside a page: eyebrow number + H2 + action + content, tone per section.
 */
import Link from "next/link";
import { cn } from "@/lib/utils";

export type BandTone = "white" | "page" | "alt" | "ink";
const BAND_PAINT: Record<BandTone, string> = { white: "band-white", page: "band-page", alt: "band-alt", ink: "band-ink" };
const BAND_PAD = { none: "", sm: "py-4", md: "py-6", lg: "py-8" } as const;

export function PageBand({ tone = "page", pad = "md", inner, as: Tag = "section", id, className, fill, children, ...rest }: {
  tone?: BandTone; pad?: keyof typeof BAND_PAD; inner?: string; as?: "section" | "div" | "aside" | "header" | "footer"; id?: string; className?: string;
  /** stretch to at least the viewport height below the sticky header (rails) */ fill?: boolean; children: React.ReactNode;
} & Omit<React.HTMLAttributes<HTMLElement>, "className" | "children" | "id">) {
  return (
    <Tag id={id} data-band={tone} className={cn(BAND_PAINT[tone], BAND_PAD[pad], id && "scroll-under-header", fill && "min-h-[calc(100dvh-var(--ops-header-h,8rem))]", className)} {...rest}>
      {inner ? <div className={cn("mx-auto w-full", inner)}>{children}</div> : children}
    </Tag>
  );
}

/** Numbered page section on its own band: `<BandSection number={1} title="Lines" tone="page" action={…}>`. */
export function BandSection({ number, title, eyebrow, action, tone = "page", pad = "md", id, className, children, ...rest }: {
  number?: number | string; title: React.ReactNode; eyebrow?: React.ReactNode; action?: React.ReactNode; tone?: BandTone; pad?: keyof typeof BAND_PAD; id?: string; className?: string; children: React.ReactNode;
} & Omit<React.HTMLAttributes<HTMLElement>, "className" | "children" | "id" | "title">) {
  return (
    <PageBand tone={tone} pad={pad} id={id} className={className} {...rest}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {number !== undefined && <span className="inline-flex h-[22px] shrink-0 items-center rounded-full border border-green-200 bg-green-50 px-2.5 font-mono text-2xs font-medium text-green-700">{String(number).padStart(2, "0")}</span>}
          <h2 className="truncate text-lg font-semibold">{title}</h2>
          {eyebrow}
        </div>
        {action && <div className="flex flex-wrap items-center gap-2">{action}</div>}
      </div>
      {children}
    </PageBand>
  );
}

/** DESIGN §4.4: a section-alt ground (filters, rails, compare bar). Cards may sit on it; never a card on a card. */
export function SectionBand({ children, className, bleed, as: Tag = "section" }: { children: React.ReactNode; className?: string; /** escape the page gutter */ bleed?: boolean; as?: "section" | "div" | "aside" }) {
  return (
    <Tag className={cn("border-y border-hairline-strong bg-section-alt px-4 py-3 sm:px-6", bleed && "-mx-4 sm:-mx-6", className)}>
      {children}
    </Tag>
  );
}

/** Stacked-section heading with the single 1px ink rule (TAVRO manifestSectionClass at 1px). */
export function SectionHeading({ number, title, action, className }: { number?: string | number; title: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-center justify-between gap-3 border-t border-rule-ink pt-4", className)}>
      <div className="flex items-center gap-3">
        {number !== undefined && <span className="inline-flex h-[22px] items-center rounded-full border border-green-200 bg-green-50 px-2.5 font-mono text-2xs font-medium text-green-700">{String(number).padStart(2, "0")}</span>}
        <h2 className="text-lg font-semibold">{title}</h2>
      </div>
      {action}
    </div>
  );
}

/** The TAVRO "sheet list": one bordered object, rows parted by hairlines. */
export function SheetList({ children, className, as: Tag = "ul" }: { children: React.ReactNode; className?: string; as?: "ul" | "ol" | "div" }) {
  return <Tag className={cn("sheet", className)}>{children}</Tag>;
}
export function SheetRow({ children, className, as: Tag = "li", href, interactive }: { children: React.ReactNode; className?: string; as?: "li" | "div"; href?: string; interactive?: boolean }) {
  const cls = cn("sheet-row flex items-center gap-3", (interactive || href) && "transition-colors duration-[120ms] hover:bg-surface-sunken", className);
  if (href) return <Tag className="list-none"><Link href={href} className={cn(cls, "flex")}>{children}</Link></Tag>;
  return <Tag className={cls}>{children}</Tag>;
}
