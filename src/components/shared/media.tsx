"use client";
/**
 * Product pictures for every table, list and header — client portal and ops alike. The picture leads, the title
 * follows: a photo identifies a product faster than any name. One component family, three shapes:
 *   <ProductThumb>  one picture (hover → 16 rem preview), or a placeholder with the shop domain
 *   <ThumbStack>    up to three overlapping pictures + "+N" for multi-product rows (orders, requests, ranges)
 *   <MediaCell>     picture + title + sub-line — the standard first column of a product table
 * Images load as resized thumbnails (`thumbUrl`), lazily, with fixed boxes (no layout shift).
 */
import * as React from "react";
import { ImageOff } from "lucide-react";
import { HoverCard } from "radix-ui";
import { cn } from "@/lib/utils";
import { thumbUrl } from "@/lib/media";

export type ThumbImage = { url: string } | null;
export type ThumbItem = { name: string; image: ThumbImage };

const SIZE = {
  sm: { px: 40, box: "size-10" },
  md: { px: 56, box: "size-14" },
  lg: { px: 72, box: "size-[4.5rem]" },
  xl: { px: 96, box: "size-24" },
} as const;
export type ThumbSize = keyof typeof SIZE;
const PREVIEW_PX = 256;

export function ProductThumb({ image, name, domain, size = "md", preview = true, className }: {
  image: ThumbImage; name: string; domain?: string | null; size?: ThumbSize; preview?: boolean; className?: string;
}) {
  const s = SIZE[size];
  if (!image) {
    return (
      <div className={cn(s.box, "flex shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg border border-dashed border-hairline-strong bg-section-alt text-muted-foreground", className)} data-testid="product-thumb-empty" title={domain ? `No photo yet — ${domain}` : "No photo yet"}>
        <ImageOff className="size-4" strokeWidth={1.75} aria-hidden />
        {domain && size !== "sm" && <span className="max-w-full truncate px-1 text-[10px] leading-3">{domain}</span>}
      </div>
    );
  }
  const thumb = (
    <div className={cn(s.box, "shrink-0 overflow-hidden rounded-lg border border-border bg-section-alt", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element -- same-origin /api/files (access-checked + resized there), not an optimisable remote host */}
      <img src={thumbUrl(image.url, s.px)} alt={name} width={s.px} height={s.px} className="size-full object-cover" loading="lazy" decoding="async" data-testid="product-thumb" />
    </div>
  );
  if (!preview) return thumb;
  return (
    <HoverCard.Root openDelay={120} closeDelay={60}>
      <HoverCard.Trigger asChild>{thumb}</HoverCard.Trigger>
      <HoverCard.Portal>
        <HoverCard.Content side="right" align="center" sideOffset={10} className="z-50 w-64 overflow-hidden rounded-xl border border-border bg-card shadow-lg data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95">
          {/* eslint-disable-next-line @next/next/no-img-element -- see above */}
          <img src={thumbUrl(image.url, PREVIEW_PX)} alt="" width={PREVIEW_PX} height={PREVIEW_PX} className="aspect-square w-full object-cover" decoding="async" />
          <div className="px-3 py-2 text-xs font-medium leading-4 text-foreground">{name}</div>
        </HoverCard.Content>
      </HoverCard.Portal>
    </HoverCard.Root>
  );
}

/** Up to three overlapping pictures (+N) for a row that holds several products. */
export function ThumbStack({ items, size = "md", total }: { items: ThumbItem[]; size?: ThumbSize; /** product count when `items` is truncated */ total?: number }) {
  const shown = items.slice(0, 3);
  const more = (total ?? items.length) - shown.length;
  if (!shown.length) return <ProductThumb image={null} name="" size={size} />;
  return (
    <div className="flex shrink-0 items-center" data-testid="thumb-stack">
      {shown.map((it, i) => (
        <ProductThumb key={i} image={it.image} name={it.name} size={size} preview={shown.length === 1} className={cn(i > 0 && "-ml-4 ring-2 ring-card")} />
      ))}
      {more > 0 && <span className="-ml-2 inline-flex h-6 min-w-6 items-center justify-center rounded-full border border-border bg-card px-1.5 font-mono text-2xs text-ink-2">+{more}</span>}
    </div>
  );
}

type MediaCellBase = {
  title: React.ReactNode;
  /** muted line under the title — refs and figures are mono (wrap words in <span className="font-sans">) */
  sub?: React.ReactNode;
  /** small line above the title (refs, badges) */
  overline?: React.ReactNode;
  /** anything below the sub-line (status chip, badge) */
  extra?: React.ReactNode;
  size?: ThumbSize;
  /** dense = ops tables (14 px title) · comfortable = client portal (15 px title, more air) */
  variant?: "dense" | "comfortable";
  /** max width of the text block, e.g. "max-w-[30ch]" */
  textWidth?: string;
  className?: string;
};
type MediaCellProps = MediaCellBase & ({ image: ThumbImage; name?: string; domain?: string | null } | { items: ThumbItem[]; total?: number });

/**
 * Standard first column of a product table: picture, then title and muted sub-line. Pass `image` for one product or
 * `items` for an order / request / range. Every product table on both sides uses this — change it here, once.
 */
export function MediaCell(props: MediaCellProps) {
  const { title, sub, overline, extra, size = "md", variant = "dense", textWidth = "max-w-[34ch]", className } = props;
  const alt = "name" in props && props.name ? props.name : typeof title === "string" ? title : "";
  const comfy = variant === "comfortable";
  return (
    <div className={cn("flex min-w-0 items-center", comfy ? "gap-4 py-1.5" : "gap-3 py-1", className)}>
      {"items" in props
        ? <ThumbStack items={props.items} total={props.total} size={size} />
        : <ProductThumb image={props.image} name={alt} domain={props.domain} size={size} />}
      <div className={cn("min-w-0", textWidth)}>
        {overline}
        <div className={cn("truncate font-sans font-medium text-foreground", comfy ? "text-[15px] leading-5" : "text-sm leading-5")} title={typeof title === "string" ? title : undefined}>{title}</div>
        {sub && <div className="truncate font-mono text-xs leading-4 text-muted-foreground">{sub}</div>}
        {extra}
      </div>
    </div>
  );
}
