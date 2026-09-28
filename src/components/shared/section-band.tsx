import Link from "next/link";
import { cn } from "@/lib/utils";

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
